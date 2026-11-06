import type { AguiEvent, RunAgentInput } from "../../shared/agui";
import { SseParser } from "./sse";

/**
 * Runs an AG-UI agent over HTTP + Server-Sent Events and calls `onEvent` for each event.
 * This is the same wire format that @ag-ui/client HttpAgent uses, without the extra dependencies.
 */
export async function runAgent(url: string, input: RunAgentInput, onEvent: (e: AguiEvent) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(input),
      signal
    });
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
