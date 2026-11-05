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

export const PROJECT_COLORS = ["indigo", "teal", "amber", "rose", "violet", "slate"] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

export interface User {
  id: string;
  email: string;
  name: string;
}

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
  taskCount: number;
  doneCount: number;
  lateCount: number;
  memberCount: number;
  updatedAt: string;
}

export interface ProjectDetail {
  project: ProjectInfo;
  role: Role;
  columns: Column[];
  /** The project's AI agent policy, by role. */
  aiPolicy: AiPolicy;
  /** What the AI agent may do for the person viewing, after their role and the policy. */
  agentLevel: AgentLevel;
  members: Member[];
  invitations: Invitation[];
  tasks: Task[];
  attachments: Attachment[];
}

export interface AppConfig {
  appName: string;
  emailEnabled: boolean;
  signupMode: "open" | "invite";
  aiProvider: string;
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
export type AiPolicy = Record<Role, AgentLevel> & { scope: AgentScope };

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
