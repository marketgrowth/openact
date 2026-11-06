import { useCallback, useRef, useState } from "react";
import { CUSTOM_EVENTS, type Message, type OpenActAgentState, type ResumeEntry, type RunAgentInput, type Tool } from "../../shared/agui";
import { runAgent } from "./client";
import { emptyRun, reduceEvent, type ChatMessage, type RunView } from "./reducer";
import { executeToolCall, type UiToolHandlers } from "./tools";

const MAX_ROUNDS = 4;
const newId = () => crypto.randomUUID();

/** Converts the UI's chat messages to AG-UI messages for RunAgentInput. */
export function toAguiMessages(messages: ChatMessage[]): Message[] {
  return messages.map((m): Message => {
    if (m.role === "tool") return { id: m.id, role: "tool", content: m.content, toolCallId: m.toolCallId ?? "" };
    if (m.role === "assistant") {
      return {
        id: m.id,
        role: "assistant",
        content: m.content,
        ...(m.toolCalls?.length ? { toolCalls: m.toolCalls.map((t) => ({ id: t.id, type: "function" as const, function: { name: t.name, arguments: t.args } })) } : {})
      };
    }
    return { id: m.id, role: "user", content: m.content };
  });
}

interface Options {
  url: string;
  tools: Tool[];
  getState: () => OpenActAgentState;
  getContext: () => Array<{ description: string; value: string }>;
  handlers: Partial<UiToolHandlers>;
  /** Called when the agent changed project data, so the page can reload. */
  onDataChanged?: () => void;
}

export interface Decision {
  interruptId: string;
  approved: boolean;
}

/**
 * Talks to the OpenAct agent over AG-UI.
 * - Runs frontend (view) tools that the agent asks for, then continues the run with the results.
 * - Stops on approval requests (interrupts) until the person decides, then resumes with their decisions.
 * - Stops after a few rounds, so a confused agent cannot loop.
 */
export function useAgent({ url, tools, getState, getContext, handlers, onDataChanged }: Options) {
  const [view, setView] = useState<RunView>(() => emptyRun());
  const threadId = useRef(newId());
  const abort = useRef<AbortController | null>(null);
  const viewRef = useRef(view);
  const commit = (v: RunView) => {
    viewRef.current = v;
    setView(v);
  };

  const loop = useCallback(
    async (start: RunView, resume: ResumeEntry[], forwardedProps: Record<string, unknown> = {}) => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      let v = start;
      let firstResume = resume;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const input: RunAgentInput = {
          threadId: threadId.current,
          runId: newId(),
          state: getState(),
          messages: toAguiMessages(v.messages),
          tools,
          context: getContext(),
          forwardedProps: round === 0 ? forwardedProps : {},
          ...(firstResume.length ? { resume: firstResume } : {})
        };
        firstResume = [];
        await runAgent(
          url,
          input,
          (e) => {
            if (e.type === "CUSTOM" && e.name === CUSTOM_EVENTS.DATA_CHANGED) onDataChanged?.();
            v = reduceEvent(v, e);
            commit(v);
          },
          ctrl.signal
        );
        if (ctrl.signal.aborted || v.status !== "finished") break;

        // Run the view tools the agent asked for, then send the results back.
        const answered = new Set(v.messages.filter((m) => m.role === "tool").map((m) => m.toolCallId));
        const pending = v.toolCalls.filter((t) => t.done && !answered.has(t.id) && (v.pendingToolCallIds.length ? v.pendingToolCallIds.includes(t.id) : t.name in handlers));
        if (!pending.length) break;
        const results: ChatMessage[] = pending.map((t) => ({ id: newId(), role: "tool", toolCallId: t.id, content: executeToolCall(handlers, t.name, t.args).content }));
        v = { ...v, toolCalls: [], pendingToolCallIds: [], messages: [...v.messages, ...results] };
        commit(v);
      }
    },
    [url, tools, getState, getContext, handlers, onDataChanged]
  );

  const ask = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || viewRef.current.status === "running") return;
      await loop({ ...viewRef.current, interrupts: [], messages: [...viewRef.current.messages, { id: newId(), role: "user", content: q }], error: null }, []);
    },
    [loop]
  );

  /** Answers the agent's approval requests and lets it continue. */
  const decide = useCallback(
    async (decisions: Decision[]) => {
      if (viewRef.current.status !== "interrupted") return;
      const resume: ResumeEntry[] = decisions.map((d) => ({ interruptId: d.interruptId, status: "resolved", payload: { approved: d.approved } }));
      await loop({ ...viewRef.current, interrupts: [] }, resume);
    },
    [loop]
  );

  /**
   * The scope check sent a request to another project or to a new one, but the person wants it here.
   * Runs the same message again without the check. The scope rule in the agent's instructions still applies.
   */
  const keepHere = useCallback(
    async (messageId: string) => {
      const cur = viewRef.current;
      if (cur.status === "running") return;
      const i = cur.messages.findIndex((m) => m.id === messageId);
      if (i < 0) return;
      await loop({ ...cur, interrupts: [], error: null, messages: cur.messages.slice(0, i) }, [], { openact: { scope: "keep" } });
    },
    [loop]
  );

  const stop = useCallback(() => {
    abort.current?.abort();
    commit({ ...viewRef.current, status: "idle", step: null });
  }, []);

  const reset = useCallback(() => {
    abort.current?.abort();
    threadId.current = newId();
    commit(emptyRun());
  }, []);

  return { view, ask, decide, keepHere, stop, reset };
}
