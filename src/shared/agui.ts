/*
 * AG-UI (Agent-User Interaction protocol) contract for OpenAct.
 * Spec: https://docs.ag-ui.com
 *
 * The Worker exposes an AG-UI endpoint at POST /api/projects/:id/agent.
 * It takes a RunAgentInput body and streams AG-UI events as Server-Sent Events.
 * Any AG-UI client (for example @ag-ui/client HttpAgent or CopilotKit) can connect to it.
 *
 * Types come from the official @ag-ui/core package as type-only imports, so they add nothing at runtime.
 */
import type { Context, Message, RunAgentInput, Tool } from "@ag-ui/core";

export type { Context, Message, RunAgentInput, Tool };

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
  | { type: "RUN_FINISHED"; threadId: string; runId: string; result?: unknown }
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

export type ProjectView = "board" | "timeline" | "calendar" | "members";
export const PROJECT_VIEWS: ProjectView[] = ["board", "timeline", "calendar", "members"];

/**
 * Shared state the web app sends as RunAgentInput.state.
 * An agent can read it, and later change it with STATE_SNAPSHOT or STATE_DELTA events.
 */
export interface OpenActAgentState {
  projectId: string;
  projectName: string;
  view: ProjectView;
  /** The date the calendar shows, YYYY-MM-DD, or null. */
  focusDate: string | null;
  /** The task open in the drawer, or null. */
  openTaskId: string | null;
  filter: { query: string; mine: boolean };
  /** The person's local date, YYYY-MM-DD. */
  today: string;
}

/**
 * Frontend tools. The web app sends these in RunAgentInput.tools.
 * When the agent calls one (TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END), the web app runs it
 * and sends the result back as a "tool" message in the next run.
 * These tools only change what the person sees. They never change project data.
 */
export const UI_TOOLS: Tool[] = [
  {
    name: "open_task",
    description: "Open a task in the side drawer so the person can read or edit it.",
    parameters: {
      type: "object",
      properties: { taskId: { type: "string", description: "The task id." } },
      required: ["taskId"]
    }
  },
  {
    name: "show_view",
    description: "Switch the project view.",
    parameters: {
      type: "object",
      properties: { view: { type: "string", enum: PROJECT_VIEWS } },
      required: ["view"]
    }
  },
  {
    name: "go_to_date",
    description: "Show the calendar month that contains a date and highlight that day.",
    parameters: {
      type: "object",
      properties: { date: { type: "string", description: "A date in the form YYYY-MM-DD." } },
      required: ["date"]
    }
  },
  {
    name: "filter_tasks",
    description: "Filter the tasks on screen by text, or show only the person's own tasks.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to match in task titles and phases. Empty clears the filter." },
        mine: { type: "boolean", description: "True shows only tasks assigned to the person." }
      }
    }
  }
];

export type UiToolName = "open_task" | "show_view" | "go_to_date" | "filter_tasks";
