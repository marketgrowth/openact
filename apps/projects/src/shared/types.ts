/*
 * Types for the projects app. The core types (people, companies, config) are re-exported here,
 * so files in this app import everything from one place.
 */
export * from "@openact/core/shared";
import type { CompanyDetail as CoreCompanyDetail } from "@openact/core/shared";

// Types shared by the Worker API and the web app.

export const STATUSES = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" }
] as const;
export type Status = (typeof STATUSES)[number]["id"];
export const STATUS_IDS = STATUSES.map((s) => s.id) as Status[];

export const PRIORITIES = { high: "High", med: "Medium", low: "Low" } as const;
export type Priority = keyof typeof PRIORITIES;
export const PRIORITY_IDS = Object.keys(PRIORITIES) as Priority[];

export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

/** company: every company member can see it. secret: only its own members can see it. */
export const VISIBILITIES = ["company", "secret"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const VISIBILITY_LABELS: Record<Visibility, string> = { company: "Company", secret: "Secret" };
export const VISIBILITY_HELP: Record<Visibility, string> = {
  company: "Everyone in the company can see this project. Company owners and admins can manage it.",
  secret: "Only people you invite can see this project. Others who have the link can ask for access."
};

export interface AccessRequest {
  id: string;
  userId: string;
  name: string;
  email: string;
  note: string;
  createdAt: string;
}

export const PROJECT_COLORS = ["indigo", "teal", "amber", "rose", "violet", "slate"] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

export interface Column {
  id: string;
  name: string;
  /** What the column means for progress and late checks. Same values as Status. */
  category: Status;
  position: number;
}

export const DEFAULT_COLUMNS: Array<{ name: string; category: Status }> = [
  { name: "Backlog", category: "backlog" },
  { name: "To do", category: "todo" },
  { name: "In progress", category: "doing" },
  { name: "Review", category: "review" },
  { name: "Done", category: "done" }
];

/** Labels for column categories, used where a column can be chosen or explained. */
export const CATEGORY_LABELS: Record<Status, string> = {
  backlog: "Backlog (not started)",
  todo: "To do (not started)",
  doing: "In progress",
  review: "In review",
  done: "Done (counts as finished)"
};

export interface Task {
  id: string;
  projectId: string;
  /** The board column. Null only for data from before columns existed. */
  columnId: string | null;
  title: string;
  notes: string;
  status: Status;
  priority: Priority;
  phase: string;
  start: string | null;
  end: string | null;
  assigneeId: string | null;
  order: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  userId: string;
  email: string;
  name: string;
  role: Role;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface Attachment {
  id: string;
  taskId: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedBy: string | null;
  createdAt: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  description: string;
  color: ProjectColor;
  companyId: string | null;
  visibility: Visibility;
  rev: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  color: ProjectColor;
  role: Role;
  visibility: Visibility;
  /** True when the person is on the project. False when they see it through the company. */
  isMember: boolean;
  taskCount: number;
  doneCount: number;
  lateCount: number;
  memberCount: number;
  updatedAt: string;
  /** When the person pinned the project to the top of the side panel. null when it is not pinned. */
  pinnedAt: string | null;
}

/** A task the person opened lately, for the Recent list in the side panel. */
export interface RecentTask {
  taskId: string;
  projectId: string;
  title: string;
  openedAt: string;
}

export interface ProjectDetail {
  project: ProjectInfo;
  role: Role;
  columns: Column[];
  /** The project's AI agent policy, by role. */
  aiPolicy: AiPolicy;
  /** What the AI agent may do for the person viewing, after their role and the policy. */
  agentLevel: AgentLevel;
  /** The AI that runs for this project's company, as a label, such as "Claude Sonnet 5.5 (company key)". */
  aiLabel: string;
  members: Member[];
  invitations: Invitation[];
  /** Pending access requests. Only project owners get them. */
  accessRequests: AccessRequest[];
  tasks: Task[];
  attachments: Attachment[];
}

export interface TaskInput {
  columnId?: string;
  title?: string;
  notes?: string;
  status?: Status;
  priority?: Priority;
  phase?: string;
  start?: string | null;
  end?: string | null;
  assigneeId?: string | null;
  order?: number;
}

export interface PlannedTask {
  title: string;
  phase: string;
  priority: Priority;
  start: string;
  end: string;
  notes: string;
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/* AI agent permissions */

/** What the AI agent may do. Each level includes the ones before it. */
export const AGENT_LEVELS = ["off", "ask", "edit", "delete", "admin"] as const;
export type AgentLevel = (typeof AGENT_LEVELS)[number];

export const AGENT_LEVEL_LABELS: Record<AgentLevel, string> = {
  off: "Off",
  ask: "Ask only",
  edit: "Ask and edit",
  delete: "Edit and delete",
  admin: "Full, including people"
};

export const AGENT_LEVEL_HELP: Record<AgentLevel, string> = {
  off: "No AI features.",
  ask: "Answers questions and changes the view. Changes no data.",
  edit: "Also adds and edits tasks and columns.",
  delete: "Also deletes tasks and columns, after the person approves.",
  admin: "Also invites, removes and changes the roles of people, after the person approves."
};

/** How strictly the agent keeps to the project. Strict: this project only. Relaxed: also general project management questions. */
export const AGENT_SCOPES = ["strict", "relaxed"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export const AGENT_SCOPE_LABELS: Record<AgentScope, string> = {
  strict: "Strict: this project only",
  relaxed: "Relaxed: also general project management"
};

export const AGENT_SCOPE_HELP: Record<AgentScope, string> = {
  strict: "The agent answers only about this project. It declines everything else.",
  relaxed: "The agent also answers general questions about planning and running projects. It declines everything else."
};

/** The project's AI policy: the agent level for each role, and the topic scope. */
export type AiPolicy = Record<Role, AgentLevel> & {
  scope: AgentScope;
  /** Lets the agent search task notes. Off by default, because notes can hold private details. */
  readNotes: boolean;
};

export interface AgentAction {
  id: string;
  userId: string | null;
  tool: string;
  summary: string;
  status: "done" | "failed" | "pending" | "approved" | "rejected" | "expired" | "denied";
  result: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/** Company detail with this app's company setting: the AI defaults for new projects. */
export interface CompanyDetail extends CoreCompanyDetail {
  aiDefaults: AiPolicy;
}
