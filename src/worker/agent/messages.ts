/*
 * Provider-neutral chat messages with tool calls, and converters to and from each provider's format.
 * Pure functions with type-only imports, so Node can unit test this file directly.
 */
import type { Message } from "@ag-ui/core";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type AgentMsg =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name?: string; content: string };

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelOutput {
  text: string;
  toolCalls: ToolCall[];
}

let counter = 0;
const genId = () => `call_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
  }
  return {};
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
      .join("");
  }
  return "";
}

/** Converts AG-UI messages from the client into agent messages. Unknown roles are skipped. */
export function fromAguiMessages(messages: Message[], max = 24): AgentMsg[] {
  const out: AgentMsg[] = [];
  for (const m of messages.slice(-max)) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "user") {
      const t = textOf((m as { content?: unknown }).content);
      if (t.trim()) out.push({ role: "user", content: t.slice(0, 4000) });
    } else if (m.role === "assistant") {
      const a = m as { content?: unknown; toolCalls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> };
      const toolCalls = (a.toolCalls ?? [])
        .filter((t) => t && typeof t.id === "string" && typeof t.function?.name === "string")
        .map((t) => ({ id: t.id!, name: t.function!.name!, args: parseArgs(t.function!.arguments) }));
      const content = textOf(a.content);
      if (content.trim() || toolCalls.length) out.push({ role: "assistant", content, ...(toolCalls.length ? { toolCalls } : {}) });
    } else if (m.role === "tool") {
      const t = m as { toolCallId?: string; content?: unknown };
      if (typeof t.toolCallId === "string") out.push({ role: "tool", toolCallId: t.toolCallId, content: textOf(t.content).slice(0, 4000) });
    }
  }
  return pairToolResults(out);
}

/**
 * Makes the history valid for strict providers: every tool call gets a result right after its assistant message,
 * and a tool result without a matching call becomes plain user text.
 */
export function pairToolResults(msgs: AgentMsg[]): AgentMsg[] {
  const out: AgentMsg[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "tool") {
      out.push({ role: "user", content: `(Result of an earlier action) ${m.content}` });
      continue;
    }
    out.push(m);
    if (m.role === "assistant" && m.toolCalls?.length) {
      const results = new Map<string, AgentMsg>();
      let j = i + 1;
      while (j < msgs.length && msgs[j].role === "tool") {
        const t = msgs[j] as Extract<AgentMsg, { role: "tool" }>;
        if (m.toolCalls.some((c) => c.id === t.toolCallId)) results.set(t.toolCallId, t);
        else out.push({ role: "user", content: `(Result of an earlier action) ${t.content}` });
        j++;
      }
      for (const c of m.toolCalls) out.push(results.get(c.id) ?? { role: "tool", toolCallId: c.id, name: c.name, content: "This action did not run." });
      i = j - 1;
    }
  }
  return out;
}

/* Anthropic Messages API */

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export function toAnthropic(msgs: AgentMsg[], tools: ToolDef[]) {
  const system = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const messages: Array<{ role: "user" | "assistant"; content: AnthropicBlock[] }> = [];
  const push = (role: "user" | "assistant", blocks: AnthropicBlock[]) => {
    if (!blocks.length) return;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };
  for (const m of msgs) {
    if (m.role === "system") continue;
    if (m.role === "user") push("user", [{ type: "text", text: m.content }]);
    else if (m.role === "assistant") {
      const blocks: AnthropicBlock[] = m.content.trim() ? [{ type: "text", text: m.content }] : [];
      for (const c of m.toolCalls ?? []) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
      push("assistant", blocks);
    } else push("user", [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }]);
  }
  return {
    system,
    messages,
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  };
}

export function parseAnthropic(data: unknown): ModelOutput {
  const blocks = ((data as { content?: unknown[] })?.content ?? []) as Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>;
  return {
    text: blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join(""),
    toolCalls: blocks
      .filter((b) => b.type === "tool_use" && typeof b.name === "string")
      .map((b) => ({ id: b.id || genId(), name: b.name!, args: parseArgs(b.input) }))
  };
}

/* OpenAI Chat Completions API */

export function toOpenAi(msgs: AgentMsg[], tools: ToolDef[]) {
  const messages = msgs.map((m) => {
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {})
      };
    }
    if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    return { role: m.role, content: m.content };
  });
  return { messages, tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) };
}

export function parseOpenAi(data: unknown): ModelOutput {
  const msg = (data as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }> } }> })?.choices?.[0]?.message;
  return {
    text: msg?.content ?? "",
    toolCalls: (msg?.tool_calls ?? [])
      .filter((c) => typeof c.function?.name === "string")
      .map((c) => ({ id: c.id || genId(), name: c.function!.name!, args: parseArgs(c.function!.arguments) }))
  };
}

/* Workers AI. Tool results go back as plain text, which every Workers AI chat model accepts. */

export function toWorkersAi(msgs: AgentMsg[], tools: ToolDef[]) {
  const messages: Array<{ role: string; content: string }> = [];
  for (const m of msgs) {
    if (m.role === "assistant") {
      const calls = (m.toolCalls ?? []).map((c) => `I called ${c.name} with ${JSON.stringify(c.args)}.`).join("\n");
      const content = [m.content, calls].filter((x) => x.trim()).join("\n");
      if (content) messages.push({ role: "assistant", content });
    } else if (m.role === "tool") messages.push({ role: "user", content: `Result of ${m.name ?? "the action"}: ${m.content}` });
    else messages.push({ role: m.role, content: m.content });
  }
  return { messages, tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) };
}

export function parseWorkersAi(out: unknown): ModelOutput {
  if (typeof out === "string") return { text: out, toolCalls: [] };
  const o = (out ?? {}) as {
    response?: unknown;
    tool_calls?: Array<{ id?: string; name?: string; arguments?: unknown; function?: { name?: string; arguments?: unknown } }>;
    choices?: unknown;
  };
  if (o.choices) return parseOpenAi(o);
  const calls = (o.tool_calls ?? [])
    .map((c) => ({ id: c.id || genId(), name: c.name ?? c.function?.name ?? "", args: parseArgs(c.arguments ?? c.function?.arguments) }))
    .filter((c) => c.name);
  const text = typeof o.response === "string" ? o.response : o.response && typeof o.response === "object" ? JSON.stringify(o.response) : "";
  return { text, toolCalls: calls };
}

/* Dev-scripted provider for local tests without an AI account. */

/**
 * Turns lines like `/tool update_column {"columnId":"...","name":"QA"}` in the last user message into tool calls.
 * After tool results, it reports them. Use only for development and tests.
 */
export function runDevScripted(msgs: AgentMsg[]): ModelOutput {
  const lastUser = [...msgs].reverse().findIndex((m) => m.role === "user");
  const tail = lastUser === -1 ? [] : msgs.slice(msgs.length - lastUser);
  const results = tail.filter((m): m is Extract<AgentMsg, { role: "tool" }> => m.role === "tool");
  if (results.length) return { text: `Done.\n${results.map((r) => `- ${r.content}`).join("\n")}`, toolCalls: [] };
  const user = lastUser === -1 ? "" : (msgs[msgs.length - 1 - lastUser] as { content: string }).content;
  const calls: ToolCall[] = [];
  for (const line of user.split("\n")) {
    const m = line.trim().match(/^\/tool\s+([a-z_]+)\s*(\{.*\})?\s*$/);
    if (m) calls.push({ id: genId(), name: m[1], args: parseArgs(m[2] ?? "{}") });
  }
  if (calls.length) return { text: "", toolCalls: calls };
  return { text: `(dev-scripted provider) Send lines like "/tool create_task {\\"title\\":\\"Test\\"}" to call tools. You said: ${user}`, toolCalls: [] };
}
