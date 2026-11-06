import type { UiToolName } from "../../shared/agui";

/**
 * Handlers for the frontend tools in UI_TOOLS (src/shared/agui.ts).
 * Each handler gets the parsed arguments and returns a short result for the agent.
 * Throw an Error with a plain message when the action cannot run.
 */
export type UiToolHandlers = Record<UiToolName, (args: Record<string, unknown>) => string>;

export interface ToolResult {
  ok: boolean;
  content: string;
}

/** Runs one tool call from an agent. Unknown tools and bad arguments return an error result, never throw. */
export function executeToolCall(handlers: Partial<UiToolHandlers>, name: string, argsJson: string): ToolResult {
  const handler = handlers[name as UiToolName];
  if (!handler) return { ok: false, content: `The app has no action named "${name}".` };
  let args: Record<string, unknown> = {};
  if (argsJson.trim()) {
    try {
      const parsed = JSON.parse(argsJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      else return { ok: false, content: "The action arguments must be a JSON object." };
    } catch {
      return { ok: false, content: "The action arguments are not valid JSON." };
    }
  }
  try {
    return { ok: true, content: handler(args) };
  } catch (err) {
    return { ok: false, content: err instanceof Error ? err.message : "The action failed." };
  }
}
