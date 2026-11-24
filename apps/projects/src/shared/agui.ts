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
import type { Context, Interrupt, Message, ResumeEntry, RunAgentInput, RunFinishedOutcome, Tool } from "@openact/core/shared";

export type { Context, Interrupt, Message, ResumeEntry, RunAgentInput, RunFinishedOutcome, Tool };
/** The generic AG-UI events live in the core, so every app uses one copy. */
export { EventType, type AguiEvent, type JsonPatchOp } from "@openact/core/shared";

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

/** CUSTOM event names OpenAct sends. */
export const CUSTOM_EVENTS = {
  /** The agent changed project data. Value: { rev }. The web app reloads the project. */
  DATA_CHANGED: "openact.data_changed",
  /** What the agent may do in this run. Value: { level }. */
  AGENT_LEVEL: "openact.agent_level",
  /** The scope check sent the request somewhere else, or declined it. Value: ScopeNotice. */
  SCOPE: "openact.scope"
} as const;

/** Where the scope check sends a new request. */
export const SCOPE_ROUTES = ["project", "general", "other_project", "new_work", "off_topic"] as const;
export type ScopeRoute = (typeof SCOPE_ROUTES)[number];

/** What the web app shows when the agent does not answer a request itself. */
export interface ScopeNotice {
  /** decline: not for this agent. route_other: belongs to another project. suggest_new: start a new project. */
  action: "decline" | "route_other" | "suggest_new";
  route: ScopeRoute;
  /** A short label for the subject. Never the person's full message. */
  topic: string;
  /** The assistant message that explains the result. */
  messageId: string;
  project?: { id: string; name: string };
  suggestedName?: string;
}

export type UiToolName = "open_task" | "show_view" | "go_to_date" | "filter_tasks";
