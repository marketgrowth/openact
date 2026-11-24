/*
 * AG-UI (Agent-User Interaction protocol) events, shared by every OpenAct app.
 * Spec: https://docs.ag-ui.com
 *
 * An agent endpoint takes a RunAgentInput body and streams these events as Server-Sent Events.
 * Any AG-UI client (for example @ag-ui/client HttpAgent or CopilotKit) can read them.
 * Types come from the official @ag-ui/core package as type-only imports, so they add nothing at runtime.
 */
import type { Context, Interrupt, Message, ResumeEntry, RunAgentInput, RunFinishedOutcome, Tool } from "@ag-ui/core";

export type { Context, Interrupt, Message, ResumeEntry, RunAgentInput, RunFinishedOutcome, Tool };

/** Event type names, as the AG-UI spec defines them. */
export const EventType = {
  RUN_STARTED: "RUN_STARTED",
  RUN_FINISHED: "RUN_FINISHED",
  RUN_ERROR: "RUN_ERROR",
  STEP_STARTED: "STEP_STARTED",
  STEP_FINISHED: "STEP_FINISHED",
  TEXT_MESSAGE_START: "TEXT_MESSAGE_START",
  TEXT_MESSAGE_CONTENT: "TEXT_MESSAGE_CONTENT",
  TEXT_MESSAGE_END: "TEXT_MESSAGE_END",
  TOOL_CALL_START: "TOOL_CALL_START",
  TOOL_CALL_ARGS: "TOOL_CALL_ARGS",
  TOOL_CALL_END: "TOOL_CALL_END",
  TOOL_CALL_RESULT: "TOOL_CALL_RESULT",
  STATE_SNAPSHOT: "STATE_SNAPSHOT",
  STATE_DELTA: "STATE_DELTA",
  MESSAGES_SNAPSHOT: "MESSAGES_SNAPSHOT",
  CUSTOM: "CUSTOM"
} as const;

export interface JsonPatchOp {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  value?: unknown;
  from?: string;
}

/** The AG-UI events OpenAct sends and reads. Field names follow the spec exactly. */
export type AguiEvent = { timestamp?: number } & (
  | { type: "RUN_STARTED"; threadId: string; runId: string }
  | { type: "RUN_FINISHED"; threadId: string; runId: string; result?: unknown; outcome?: RunFinishedOutcome }
  | { type: "RUN_ERROR"; message: string; code?: string }
  | { type: "STEP_STARTED"; stepName: string }
  | { type: "STEP_FINISHED"; stepName: string }
  | { type: "TEXT_MESSAGE_START"; messageId: string; role: "assistant" }
  | { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
  | { type: "TEXT_MESSAGE_END"; messageId: string }
  | { type: "TOOL_CALL_START"; toolCallId: string; toolCallName: string; parentMessageId?: string }
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
  | { type: "TOOL_CALL_END"; toolCallId: string }
  | { type: "TOOL_CALL_RESULT"; messageId: string; toolCallId: string; content: string; role?: "tool" }
  | { type: "STATE_SNAPSHOT"; snapshot: unknown }
  | { type: "STATE_DELTA"; delta: JsonPatchOp[] }
  | { type: "MESSAGES_SNAPSHOT"; messages: Message[] }
  | { type: "CUSTOM"; name: string; value: unknown }
);

/** One AG-UI event as a Server-Sent Events frame. */
export function encodeSse(event: AguiEvent): string {
  return `data: ${JSON.stringify({ ...event, timestamp: event.timestamp ?? Date.now() })}\n\n`;
}

/**
 * Incremental Server-Sent Events parser. Feed it text chunks as they arrive.
 * It returns the `data` payload of every complete event. Comments and other fields are ignored.
 */
export class SseParser {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk.replace(/\r\n?/g, "\n");
    const out: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) out.push(data);
    }
    return out;
  }
}

/**
 * Runs an AG-UI agent over HTTP and Server-Sent Events, and calls `onEvent` for each event.
 * This is the wire format of @ag-ui/client HttpAgent, without its dependencies. For the web app.
 */
export async function runAguiAgent(url: string, input: RunAgentInput, onEvent: (e: AguiEvent) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    // `credentials` is a browser field. The Worker types do not know it, so the init is cast.
    const init = { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(input), signal };
    res = await fetch(url, init as unknown as RequestInit);
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    onEvent({ type: "RUN_ERROR", message: "The server cannot be reached. Check your connection." });
    return;
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    onEvent({ type: "RUN_ERROR", message: data?.error ?? `The assistant could not start (${res.status}).`, code: String(res.status) });
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = new SseParser();
  let ended = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const data of parser.push(value)) {
        let event: AguiEvent;
        try {
          event = JSON.parse(data) as AguiEvent;
        } catch {
          continue;
        }
        if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") ended = true;
        onEvent(event);
      }
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    onEvent({ type: "RUN_ERROR", message: "The connection closed before the answer finished." });
    return;
  }
  if (!ended) onEvent({ type: "RUN_ERROR", message: "The answer stopped before it finished. Try again." });
}
