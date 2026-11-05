import type { Env } from "../env";
import { ROLE_LABELS, type Role, type Status, type User } from "../../shared/types";
import { HttpError } from "../util";
import { changeMemberRole, createColumn, createTask, deleteColumn, deleteTask, inviteMember, removeMember, updateColumn, updateTask } from "../services";
import type { ToolCall } from "./messages";

/** What the agent knows about the project during one run. */
export interface Snapshot {
  projectId: string;
  projectName: string;
  tasks: Map<string, { title: string; columnId: string | null; status: Status }>;
  columns: Map<string, { name: string; category: Status; position: number }>;
  members: Map<string, { name: string; role: Role }>;
}

export async function loadSnapshot(env: Env, projectId: string): Promise<Snapshot> {
  const [p, tasks, cols, members] = await env.DB.batch([
    env.DB.prepare("SELECT name FROM projects WHERE id = ?").bind(projectId),
    env.DB.prepare("SELECT id, title, column_id, status FROM tasks WHERE project_id = ?").bind(projectId),
    env.DB.prepare("SELECT id, name, category, position FROM board_columns WHERE project_id = ? ORDER BY position").bind(projectId),
    env.DB.prepare("SELECT u.id, u.name, m.role FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ?").bind(projectId)
  ]);
  return {
    projectId,
    projectName: (p.results[0] as { name?: string } | undefined)?.name ?? "",
    tasks: new Map((tasks.results as Array<{ id: string; title: string; column_id: string | null; status: Status }>).map((t) => [t.id, { title: t.title, columnId: t.column_id, status: t.status }])),
    columns: new Map((cols.results as Array<{ id: string; name: string; category: Status; position: number }>).map((c) => [c.id, { name: c.name, category: c.category, position: c.position }])),
    members: new Map((members.results as Array<{ id: string; name: string; role: Role }>).map((m) => [m.id, { name: m.name, role: m.role }]))
  };
}

const q = (s: string) => `"${s}"`;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** A short, plain description of a tool call, for approval cards and the action log. */
export function describeCall(call: ToolCall, snap: Snapshot): string {
  const a = call.args;
  const task = snap.tasks.get(str(a.taskId));
  const col = snap.columns.get(str(a.columnId));
  const member = snap.members.get(str(a.userId));
  const taskName = task ? q(task.title) : "(an unknown task)";
  const colName = col ? q(col.name) : "(an unknown column)";
  switch (call.name) {
    case "create_task":
      return `Add task ${q(str(a.title) || "Untitled")}${snap.columns.get(str(a.columnId)) ? ` to ${q(snap.columns.get(str(a.columnId))!.name)}` : ""}`;
    case "update_task": {
      const parts: string[] = [];
      if (a.title !== undefined) parts.push(`rename to ${q(str(a.title))}`);
      if (a.columnId !== undefined) parts.push(`move to ${snap.columns.get(str(a.columnId)) ? q(snap.columns.get(str(a.columnId))!.name) : "an unknown column"}`);
      if (a.start !== undefined || a.end !== undefined) parts.push(`set dates ${str(a.start) || "?"} to ${str(a.end) || str(a.start) || "?"}`);
      if (a.assigneeId !== undefined) parts.push(a.assigneeId ? `assign to ${snap.members.get(str(a.assigneeId))?.name ?? "an unknown person"}` : "unassign");
      if (a.priority !== undefined) parts.push(`set priority ${str(a.priority)}`);
      if (a.phase !== undefined) parts.push(`set phase ${q(str(a.phase))}`);
      if (a.notes !== undefined) parts.push("change notes");
      return `Change task ${taskName}: ${parts.join(", ") || "no changes"}`;
    }
    case "delete_task":
      return `Delete task ${taskName}`;
    case "add_column":
      return `Add column ${q(str(a.name))} (${str(a.category) || "todo"})`;
    case "update_column": {
      const parts: string[] = [];
      if (a.name !== undefined) parts.push(`rename to ${q(str(a.name))}`);
      if (a.category !== undefined) parts.push(`set category ${str(a.category)}`);
      if (a.afterColumnId !== undefined) parts.push(a.afterColumnId ? `move after ${snap.columns.get(str(a.afterColumnId)) ? q(snap.columns.get(str(a.afterColumnId))!.name) : "an unknown column"}` : "move to the start");
      return `Change column ${colName}: ${parts.join(", ") || "no changes"}`;
    }
    case "delete_column": {
      const target = snap.columns.get(str(a.moveToColumnId));
      return `Delete column ${colName} and move its tasks to ${target ? q(target.name) : "an unknown column"}`;
    }
    case "invite_member":
      return `Invite ${str(a.email)} as ${ROLE_LABELS[a.role as Role] ?? "a member"}`;
    case "change_member_role":
      return `Make ${member ? member.name : "an unknown person"} ${ROLE_LABELS[a.role as Role] ?? "?"}`;
    case "remove_member":
      return `Remove ${member ? member.name : "an unknown person"} from the project`;
    default:
      return `Run ${call.name}`;
  }
}

function needTask(snap: Snapshot, id: unknown) {
  if (typeof id !== "string" || !snap.tasks.has(id)) throw new HttpError(400, "That task is not in this project.");
  return id;
}
function needColumn(snap: Snapshot, id: unknown, field = "column") {
  if (typeof id !== "string" || !snap.columns.has(id)) throw new HttpError(400, `That ${field} is not in this project.`);
  return id;
}
function needMember(snap: Snapshot, id: unknown) {
  if (typeof id !== "string" || !snap.members.has(id)) throw new HttpError(400, "That person is not a member of this project.");
  return id;
}

export interface ExecContext {
  appUrl: string;
  defer: (p: Promise<unknown>) => void;
}

/**
 * Runs one tool call as the person. The services check the person's role again,
 * and every id must belong to this project.
 */
export async function executeCall(env: Env, actor: User, call: ToolCall, snap: Snapshot, ctx: ExecContext): Promise<string> {
  const a = call.args;
  const pid = snap.projectId;
  switch (call.name) {
    case "create_task": {
      if (a.columnId !== undefined) needColumn(snap, a.columnId);
      if (a.assigneeId) needMember(snap, a.assigneeId);
      const { task } = await createTask(env, actor, pid, a);
      snap.tasks.set(task.id, { title: task.title, columnId: task.columnId, status: task.status });
      return `Added task "${task.title}" (id ${task.id}).`;
    }
    case "update_task": {
      const id = needTask(snap, a.taskId);
      if (a.columnId !== undefined) needColumn(snap, a.columnId);
      if (a.assigneeId) needMember(snap, a.assigneeId);
      const { taskId: _skip, ...fields } = a;
      const { task } = await updateTask(env, actor, id, fields);
      snap.tasks.set(task.id, { title: task.title, columnId: task.columnId, status: task.status });
      return `Changed task "${task.title}".`;
    }
    case "delete_task": {
      const id = needTask(snap, a.taskId);
      const { title } = await deleteTask(env, actor, id);
      snap.tasks.delete(id);
      return `Deleted task "${title}".`;
    }
    case "add_column": {
      if (a.afterColumnId) needColumn(snap, a.afterColumnId);
      const { column } = await createColumn(env, actor, pid, a);
      snap.columns.set(column.id, { name: column.name, category: column.category, position: column.position });
      return `Added column "${column.name}" (id ${column.id}).`;
    }
    case "update_column": {
      const id = needColumn(snap, a.columnId);
      if (a.afterColumnId) needColumn(snap, a.afterColumnId);
      const { columnId: _skip, ...fields } = a;
      const { column } = await updateColumn(env, actor, id, fields);
      snap.columns.set(column.id, { name: column.name, category: column.category, position: column.position });
      return `Changed column "${column.name}".`;
    }
    case "delete_column": {
      const id = needColumn(snap, a.columnId);
      const moveTo = needColumn(snap, a.moveToColumnId, "target column");
      const { name, moved } = await deleteColumn(env, actor, id, moveTo);
      snap.columns.delete(id);
      return `Deleted column "${name}" and moved ${moved} ${moved === 1 ? "task" : "tasks"}.`;
    }
    case "invite_member": {
      const r = await inviteMember(env, actor, pid, a, ctx.appUrl, ctx.defer);
      return r.added === "member" ? `Added ${r.email} as ${ROLE_LABELS[r.role]}.` : `Invited ${r.email} as ${ROLE_LABELS[r.role]}. They join when they sign in.`;
    }
    case "change_member_role": {
      const id = needMember(snap, a.userId);
      const r = await changeMemberRole(env, actor, pid, id, a.role);
      return `${snap.members.get(id)!.name} is now ${ROLE_LABELS[r.role]}.`;
    }
    case "remove_member": {
      const id = needMember(snap, a.userId);
      if (id === actor.id) throw new HttpError(400, "The agent cannot remove you. Use Leave project in the People tab.");
      await removeMember(env, actor, pid, id);
      const name = snap.members.get(id)!.name;
      snap.members.delete(id);
      return `Removed ${name} from the project.`;
    }
    default:
      throw new HttpError(400, `The app has no action named "${call.name}".`);
  }
}
