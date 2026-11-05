import type { AguiEvent, CUSTOM_EVENTS, Interrupt, JsonPatchOp, ScopeNotice } from "../../shared/agui";

// Type-only imports keep this file runnable in Node tests. The type checks that the name matches.
const SCOPE_EVENT: (typeof CUSTOM_EVENTS)["SCOPE"] = "openact.scope";

/*
 * Turns a stream of AG-UI events into a view model the UI can render.
 * Pure functions only, so it is easy to test and to reuse in other clients.
 */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  /** For role "tool": the call this message answers. */
  toolCallId?: string;
  /** For role "assistant": tool calls the agent made in this message. */
  toolCalls?: Array<{ id: string; name: string; args: string }>;
  /** For role "assistant": the scope check declined the request or sent it elsewhere. */
  scope?: ScopeNotice;
}

export interface ToolCallView {
  id: string;
  name: string;
  args: string;
  done: boolean;
  parentMessageId?: string;
}

export interface RunView {
  status: "idle" | "running" | "finished" | "interrupted" | "error";
  error: string | null;
  step: string | null;
  messages: ChatMessage[];
  /** Tool calls in the current run. */
  toolCalls: ToolCallView[];
  /** Approvals the agent is waiting for (AG-UI interrupts). */
  interrupts: Interrupt[];
  /** Frontend tool calls the web app should run before it continues. */
  pendingToolCallIds: string[];
  state: unknown;
  custom: Array<{ name: string; value: unknown }>;
}

export const emptyRun = (messages: ChatMessage[] = [], state: unknown = null): RunView => ({
  status: "idle",
  error: null,
  step: null,
  messages,
  toolCalls: [],
  interrupts: [],
  pendingToolCallIds: [],
  state,
  custom: []
});

export function reduceEvent(v: RunView, e: AguiEvent): RunView {
  switch (e.type) {
    case "RUN_STARTED":
      return { ...v, status: "running", error: null, toolCalls: [], interrupts: [], pendingToolCallIds: [] };
    case "RUN_FINISHED": {
      const o = e.outcome;
      if (o && o.type === "interrupt") return { ...v, status: "interrupted", step: null, interrupts: o.interrupts };
      const pending = o && o.type === "success" ? (o.pendingToolCallIds ?? []) : [];
      return { ...v, status: "finished", step: null, pendingToolCallIds: pending };
    }
    case "RUN_ERROR":
      return { ...v, status: "error", error: e.message, step: null };
    case "STEP_STARTED":
      return { ...v, step: e.stepName };
    case "STEP_FINISHED":
      return v.step === e.stepName ? { ...v, step: null } : v;
    case "TEXT_MESSAGE_START":
      return v.messages.some((m) => m.id === e.messageId) ? v : { ...v, messages: [...v.messages, { id: e.messageId, role: "assistant", content: "" }] };
    case "TEXT_MESSAGE_CONTENT": {
      const has = v.messages.some((m) => m.id === e.messageId);
      const messages = has
        ? v.messages.map((m) => (m.id === e.messageId ? { ...m, content: m.content + e.delta } : m))
        : [...v.messages, { id: e.messageId, role: "assistant" as const, content: e.delta }];
      return { ...v, messages };
    }
    case "TEXT_MESSAGE_END":
      return v;
    case "TOOL_CALL_START": {
      // Attach the call to its assistant message, so the history keeps calls before their results.
      const call = { id: e.toolCallId, name: e.toolCallName, args: "" };
      const parentId = e.parentMessageId;
      const has = parentId && v.messages.some((m) => m.id === parentId);
      const messages = has
        ? v.messages.map((m) => (m.id === parentId ? { ...m, toolCalls: [...(m.toolCalls ?? []), call] } : m))
        : [...v.messages, { id: parentId || e.toolCallId, role: "assistant" as const, content: "", toolCalls: [call] }];
      return { ...v, messages, toolCalls: [...v.toolCalls, { ...call, done: false, parentMessageId: parentId }] };
    }
    case "TOOL_CALL_ARGS":
      return {
        ...v,
        toolCalls: v.toolCalls.map((t) => (t.id === e.toolCallId ? { ...t, args: t.args + e.delta } : t)),
        messages: v.messages.map((m) =>
          m.toolCalls?.some((c) => c.id === e.toolCallId) ? { ...m, toolCalls: m.toolCalls.map((c) => (c.id === e.toolCallId ? { ...c, args: c.args + e.delta } : c)) } : m
        )
      };
    case "TOOL_CALL_END":
      return { ...v, toolCalls: v.toolCalls.map((t) => (t.id === e.toolCallId ? { ...t, done: true } : t)) };
    case "TOOL_CALL_RESULT":
      return { ...v, messages: [...v.messages, { id: e.messageId, role: "tool", content: e.content, toolCallId: e.toolCallId }] };
    case "STATE_SNAPSHOT":
      return { ...v, state: e.snapshot };
    case "STATE_DELTA":
      return { ...v, state: applyPatch(v.state, e.delta) };
    case "MESSAGES_SNAPSHOT":
      return {
        ...v,
        messages: e.messages
          .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "tool")
          .map((m) => ({
            id: m.id,
            role: m.role as ChatMessage["role"],
            content: typeof (m as { content?: unknown }).content === "string" ? ((m as { content: string }).content) : "",
            toolCallId: (m as { toolCallId?: string }).toolCallId
          }))
      };
    case "CUSTOM": {
      const next = { ...v, custom: [...v.custom, { name: e.name, value: e.value }] };
      if (e.name === SCOPE_EVENT && e.value && typeof e.value === "object") {
        const notice = e.value as ScopeNotice;
        next.messages = v.messages.map((m) => (m.id === notice.messageId ? { ...m, scope: notice } : m));
      }
      return next;
    }
    default:
      return v;
  }
}

/* A small JSON Patch (RFC 6902) for STATE_DELTA: add, remove, replace, move, copy and test. */

function unescape(seg: string) {
  return seg.replace(/~1/g, "/").replace(/~0/g, "~");
}

function parent(root: unknown, path: string): [Record<string, unknown> | unknown[], string] {
  const parts = path.split("/").slice(1).map(unescape);
  const key = parts.pop() ?? "";
  let cur = root as Record<string, unknown>;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") throw new Error(`Bad JSON Patch path: ${path}`);
    cur = (cur as Record<string, unknown>)[p] as Record<string, unknown>;
  }
  if (cur == null || typeof cur !== "object") throw new Error(`Bad JSON Patch path: ${path}`);
  return [cur, key];
}

function get(root: unknown, path: string): unknown {
  if (path === "") return root;
  const [p, key] = parent(root, path);
  return Array.isArray(p) ? p[Number(key)] : (p as Record<string, unknown>)[key];
}

function put(root: unknown, path: string, value: unknown, insert: boolean): unknown {
  if (path === "") return value;
  const [p, key] = parent(root, path);
  if (Array.isArray(p)) {
    const i = key === "-" ? p.length : Number(key);
    if (insert) p.splice(i, 0, value);
    else p[i] = value;
  } else (p as Record<string, unknown>)[key] = value;
  return root;
}

function del(root: unknown, path: string): unknown {
  const [p, key] = parent(root, path);
  if (Array.isArray(p)) p.splice(Number(key), 1);
  else delete (p as Record<string, unknown>)[key];
  return root;
}

export function applyPatch(state: unknown, ops: JsonPatchOp[]): unknown {
  let doc: unknown = state === undefined ? null : structuredClone(state);
  for (const op of ops) {
    switch (op.op) {
      case "add":
        doc = put(doc, op.path, structuredClone(op.value), true);
        break;
      case "replace":
        doc = put(doc, op.path, structuredClone(op.value), false);
        break;
      case "remove":
        doc = del(doc, op.path);
        break;
      case "copy":
        doc = put(doc, op.path, structuredClone(get(doc, op.from ?? "")), true);
        break;
      case "move": {
        const val = get(doc, op.from ?? "");
        doc = del(doc, op.from ?? "");
        doc = put(doc, op.path, val, true);
        break;
      }
      case "test":
        if (JSON.stringify(get(doc, op.path)) !== JSON.stringify(op.value)) throw new Error(`JSON Patch test failed at ${op.path}`);
        break;
    }
  }
  return doc;
}
