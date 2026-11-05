import { useCallback, useRef, useState } from "react";
import type { Message, OpenActAgentState, RunAgentInput, Tool } from "../../shared/agui";
import { runAgent } from "./client";
import { emptyRun, reduceEvent, type ChatMessage, type RunView } from "./reducer";
import { executeToolCall, type UiToolHandlers } from "./tools";

const MAX_TOOL_ROUNDS = 3;
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
}

/**
 * Talks to an AG-UI agent. Keeps one thread per hook instance.
 * When the agent calls frontend tools, the hook runs them and starts a follow-up run with the results,
 * as the AG-UI spec describes. It stops after a few rounds so a confused agent cannot loop.
 */
export function useAgent({ url, tools, getState, getContext, handlers }: Options) {
  const [view, setView] = useState<RunView>(() => emptyRun());
  const threadId = useRef(newId());
  const abort = useRef<AbortController | null>(null);
  const viewRef = useRef(view);
  const commit = (v: RunView) => {
    viewRef.current = v;
    setView(v);
  };

  const ask = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || viewRef.current.status === "running") return;
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      let v: RunView = { ...viewRef.current, messages: [...viewRef.current.messages, { id: newId(), role: "user", content: q }], error: null };
      commit(v);

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const input: RunAgentInput = {
          threadId: threadId.current,
          runId: newId(),
          state: getState(),
          messages: toAguiMessages(v.messages),
          tools,
          context: getContext(),
          forwardedProps: {}
        };
        await runAgent(
          url,
          input,
          (e) => {
            v = reduceEvent(v, e);
            commit(v);
          },
          ctrl.signal
        );
        if (ctrl.signal.aborted || v.status === "error") break;

        // Run the frontend tools the agent asked for, then send the results back.
        const calls = v.toolCalls.filter((t) => t.done);
        if (!calls.length) break;
        const assistant: ChatMessage = { id: newId(), role: "assistant", content: "", toolCalls: calls.map((t) => ({ id: t.id, name: t.name, args: t.args })) };
        const results: ChatMessage[] = calls.map((t) => ({ id: newId(), role: "tool", toolCallId: t.id, content: executeToolCall(handlers, t.name, t.args).content }));
        v = { ...v, toolCalls: [], messages: [...v.messages, assistant, ...results] };
        commit(v);
      }
    },
    [url, tools, getState, getContext, handlers]
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

  return { view, ask, stop, reset };
}
