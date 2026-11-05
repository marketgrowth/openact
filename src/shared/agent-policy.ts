/*
 * Who may tell the AI agent to do what.
 *
 * Rule 1: the agent never has more power than the person using it. Each role has a ceiling.
 * Rule 2: owners can lower what the agent may do for each role in their project (the AI policy).
 * Rule 3: deletes, people changes and large batches wait for the person to approve them.
 *
 * Pure module, no runtime imports, so the Worker, the web app and the tests share it.
 */
import type { AgentLevel, AiPolicy, Role } from "./types";

const ORDER: AgentLevel[] = ["off", "ask", "edit", "delete", "admin"];
export const levelRank = (l: AgentLevel) => ORDER.indexOf(l);
export const atLeast = (have: AgentLevel, need: AgentLevel) => levelRank(have) >= levelRank(need);
const minLevel = (a: AgentLevel, b: AgentLevel): AgentLevel => (levelRank(a) <= levelRank(b) ? a : b);

/** The most the agent can ever do for each role. */
export const ROLE_CEILING: Record<Role, AgentLevel> = { viewer: "ask", editor: "edit", owner: "admin" };

export const DEFAULT_POLICY: AiPolicy = { viewer: "ask", editor: "edit", owner: "admin" };

/** Reads a stored policy. Unknown or missing values fall back to the defaults, and every value is capped at its role's ceiling. */
export function parsePolicy(raw: unknown): AiPolicy {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === "object" && !Array.isArray(v)) obj = v as Record<string, unknown>;
    } catch {
      /* use defaults */
    }
  } else if (raw && typeof raw === "object") obj = raw as Record<string, unknown>;
  const out = { ...DEFAULT_POLICY };
  for (const role of Object.keys(ROLE_CEILING) as Role[]) {
    const v = obj[role];
    if (typeof v === "string" && (ORDER as string[]).includes(v)) out[role] = minLevel(v as AgentLevel, ROLE_CEILING[role]);
  }
  return out;
}

/** What the agent may do for this person in this project. */
export function effectiveLevel(role: Role, policy: AiPolicy): AgentLevel {
  return minLevel(ROLE_CEILING[role], policy[role] ?? DEFAULT_POLICY[role]);
}

/* Agent tools that run on the server and change data */

export type ToolRisk = "write" | "delete" | "people";

export interface BackendTool {
  name: string;
  description: string;
  /** The lowest agent level that may use the tool. */
  level: AgentLevel;
  risk: ToolRisk;
  parameters: Record<string, unknown>;
}

const str = (description: string) => ({ type: "string", description });
const date = (description: string) => ({ type: "string", description: `${description} Format YYYY-MM-DD.` });
const CATEGORY = { type: "string", enum: ["backlog", "todo", "doing", "review", "done"], description: "What the column means: backlog and todo are not started, doing and review are in progress, done is finished." };
const PRIORITY = { type: "string", enum: ["high", "med", "low"] };
const ROLE = { type: "string", enum: ["owner", "editor", "viewer"] };

export const BACKEND_TOOLS: BackendTool[] = [
  {
    name: "create_task",
    description: "Add a task to the project.",
    level: "edit",
    risk: "write",
    parameters: {
      type: "object",
      properties: {
        title: str("Short title that starts with a verb."),
        columnId: str("The column id. Leave out to use the first To do column."),
        phase: str("Phase name, for example Design."),
        priority: PRIORITY,
        start: date("Start date."),
        end: date("End date."),
        assigneeId: str("User id of a project member."),
        notes: str("Optional notes.")
      },
      required: ["title"]
    }
  },
  {
    name: "update_task",
    description: "Change a task: title, column (to move it), phase, priority, dates, assignee or notes. Send only the fields to change.",
    level: "edit",
    risk: "write",
    parameters: {
      type: "object",
      properties: {
        taskId: str("The task id."),
        title: str("New title."),
        columnId: str("Move the task to this column id."),
        phase: str("New phase."),
        priority: PRIORITY,
        start: date("New start date."),
        end: date("New end date."),
        assigneeId: { type: ["string", "null"], description: "User id of a project member, or null to unassign." },
        notes: str("New notes.")
      },
      required: ["taskId"]
    }
  },
  {
    name: "delete_task",
    description: "Delete a task and its files. The person must approve.",
    level: "delete",
    risk: "delete",
    parameters: { type: "object", properties: { taskId: str("The task id.") }, required: ["taskId"] }
  },
  {
    name: "add_column",
    description: "Add a column to the board.",
    level: "edit",
    risk: "write",
    parameters: {
      type: "object",
      properties: {
        name: str("Column name."),
        category: CATEGORY,
        afterColumnId: str("Put the new column after this column id. Leave out to add it at the end.")
      },
      required: ["name", "category"]
    }
  },
  {
    name: "update_column",
    description: "Rename a column, change its category, or move it. Send only the fields to change.",
    level: "edit",
    risk: "write",
    parameters: {
      type: "object",
      properties: {
        columnId: str("The column id."),
        name: str("New name."),
        category: CATEGORY,
        afterColumnId: { type: ["string", "null"], description: "Move the column after this column id. Null moves it to the start." }
      },
      required: ["columnId"]
    }
  },
  {
    name: "delete_column",
    description: "Delete a column. Its tasks move to another column. The person must approve.",
    level: "delete",
    risk: "delete",
    parameters: {
      type: "object",
      properties: { columnId: str("The column to delete."), moveToColumnId: str("The column that gets its tasks.") },
      required: ["columnId", "moveToColumnId"]
    }
  },
  {
    name: "invite_member",
    description: "Invite a person to the project by email. The person must approve.",
    level: "admin",
    risk: "people",
    parameters: { type: "object", properties: { email: str("Email address."), role: ROLE }, required: ["email", "role"] }
  },
  {
    name: "change_member_role",
    description: "Change a member's role. The person must approve.",
    level: "admin",
    risk: "people",
    parameters: { type: "object", properties: { userId: str("The member's user id."), role: ROLE }, required: ["userId", "role"] }
  },
  {
    name: "remove_member",
    description: "Remove a member from the project. Their tasks become unassigned. The person must approve.",
    level: "admin",
    risk: "people",
    parameters: { type: "object", properties: { userId: str("The member's user id.") }, required: ["userId"] }
  }
];

export const BACKEND_TOOL_NAMES = new Set(BACKEND_TOOLS.map((t) => t.name));

/** The tools the agent gets at a level. */
export function toolsForLevel(level: AgentLevel): BackendTool[] {
  return BACKEND_TOOLS.filter((t) => atLeast(level, t.level));
}

/** Changes in one step at or above this count wait for approval. */
export const BULK_APPROVAL_THRESHOLD = 5;

/** True when this set of changes must wait for the person to approve it. */
export function needsApproval(calls: Array<{ name: string }>): boolean {
  const tools = calls.map((c) => BACKEND_TOOLS.find((t) => t.name === c.name)).filter((t): t is BackendTool => !!t);
  if (tools.some((t) => t.risk === "delete" || t.risk === "people")) return true;
  return tools.length >= BULK_APPROVAL_THRESHOLD;
}

/** Minutes an approval request stays open. */
export const APPROVAL_TTL_MINUTES = 30;
