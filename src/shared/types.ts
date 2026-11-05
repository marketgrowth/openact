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

export interface Task {
  id: string;
  projectId: string;
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
