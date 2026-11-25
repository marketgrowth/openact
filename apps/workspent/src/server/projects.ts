import { Hono, type Context } from "hono";
import {
  HttpError,
  appService,
  companyAppState,
  emailButton,
  emailLayout,
  escapeHtml,
  isEmail,
  isSuperAdmin,
  newId,
  normalizeEmail,
  nowIso,
  oneOf,
  randomToken,
  readJson,
  requireUser,
  sendEmail,
  sha256Hex,
  text,
  type AppEnv,
  type Env
} from "@openact/core/server";
import { APPROVE_PATH, isDate, weekStart } from "../shared/rules.ts";
import {
  BUDGET_WARN,
  CURRENCIES,
  GROUPS,
  LINK_DAYS,
  MAX_ENTRY_MINUTES,
  MEMBER_KINDS,
  ROUNDING,
  SITE_KEY,
  centsFrom,
  effectiveKinds,
  entryCents,
  entryCsv,
  groupReport,
  rangeProblem,
  readKinds,
  roundMinutes,
  timerMinutes,
  weekDates,
  weekStatus,
  type ApprovalView,
  type ClientInfo,
  type EntryInfo,
  type GroupBy,
  type Kinds,
  type MemberInfo,
  type MemberKind,
  type MyProjectTime,
  type ProjectInfo,
  type ReportData,
  type ReportEntry,
  type TaskInfo,
  type TimeLogData,
  type WeekPart,
  type WeekPerson,
  type WeekStatus,
  type WorkSettings
} from "../shared/projects.ts";
import { loadAccess, type Access } from "./store.ts";

/*
 * The Projects kind of work, under /api/apps/workspent/companies/:id, plus the client approval link under /approve.
 * Projects and tasks come from the Projects app through its services, which check who can see each project.
 * A person logs time only on projects they can see. Managers (workspent.manage) see everyone's time.
 * A person sends their week. Each part (one client, or no client) is approved by a manager or by the client's link.
 * An approved part locks, and its entries keep the rate they had.
 */

export const projectRoutes = new Hono<AppEnv>();
export const approveRoutes = new Hono<AppEnv>();

type ProjectsServices = {
  visibleProjects: (env: Env, companyId: string, userId: string) => Promise<Array<{ id: string; name: string; color: string }>>;
  projectTasks: (env: Env, projectId: string) => Promise<TaskInfo[]>;
};

const UUIDISH = /^[0-9a-f-]{36}$/;
const idParam = (c: Context<AppEnv>, name: string, what: string) => {
  const v = c.req.param(name) ?? "";
  if (!UUIDISH.test(v)) throw new HttpError(404, `This ${what} does not exist.`);
  return v;
};

async function ctx(c: Context<AppEnv>): Promise<{ companyId: string; access: Access }> {
  const user = requireUser(c);
  const companyId = c.req.param("id")!;
  return { companyId, access: await loadAccess(c.env, companyId, user.id) };
}

const deny = (what: string) =>
  new HttpError(403, `Your role in this company does not allow this: ${what}. Ask a company owner or admin to change it in Company settings.`, "no_permission");

function requireTrack(a: Access) {
  if (!a.track) throw deny("Log time on projects");
}
function requireManageTime(a: Access) {
  if (!a.manageAll) throw deny("Manage hours");
}
function requireSetupTime(a: Access) {
  if (!a.setup) throw deny("Set up WorkSpent");
}

/* Settings and kinds of work ---------------------------------------- */

interface SettingsRow {
  kinds_json: string | null;
  currency: string;
  rounding_minutes: number;
}

async function siteKinds(env: Env): Promise<Kinds | null> {
  const r = await env.DB.prepare("SELECT value FROM site_settings WHERE key = ?").bind(SITE_KEY).first<{ value: string }>();
  return readKinds(r?.value);
}

async function settingsRow(env: Env, companyId: string): Promise<SettingsRow | null> {
  return env.DB.prepare("SELECT kinds_json, currency, rounding_minutes FROM workspent_settings WHERE company_id = ?").bind(companyId).first<SettingsRow>();
}

/** The kinds of work that are on for a company, with its currency and rounding. */
export async function companyKinds(
  env: Env,
  companyId: string
): Promise<{
  kinds: Kinds;
  currency: string;
  rounding: number;
  fromSite: boolean;
  site: Kinds;
}> {
  const [row, site] = await Promise.all([settingsRow(env, companyId), siteKinds(env)]);
  const own = readKinds(row?.kinds_json);
  const siteOrDefault = site ?? { projects: true, shifts: true };
  return {
    kinds: effectiveKinds(own, siteOrDefault),
    currency: row?.currency ?? "USD",
    rounding: row?.rounding_minutes ?? 0,
    fromSite: !own,
    site: siteOrDefault
  };
}

async function requireProjectsOn(env: Env, companyId: string) {
  const k = await companyKinds(env, companyId);
  if (!k.kinds.projects) throw new HttpError(409, "Projects is off for this company. A company owner or admin can turn it on in WorkSpent settings.", "projects_off");
  return k;
}

function projectsService(): ProjectsServices | null {
  const visibleProjects = appService<ProjectsServices["visibleProjects"]>("projects", "visibleProjects");
  const projectTasks = appService<ProjectsServices["projectTasks"]>("projects", "projectTasks");
  return visibleProjects && projectTasks ? { visibleProjects, projectTasks } : null;
}

/** The projects a person can see. Empty when the Projects app is not installed or is off. */
async function visibleFor(env: Env, companyId: string, userId: string) {
  const svc = projectsService();
  if (!svc) return [];
  return svc.visibleProjects(env, companyId, userId);
}

async function projectsAppOn(env: Env, companyId: string) {
  if (!projectsService()) return false;
  return (await companyAppState(env, companyId)).enabled("projects");
}

projectRoutes.get("/companies/:id/settings", async (c) => {
  const { companyId, access } = await ctx(c);
  const k = await companyKinds(c.env, companyId);
  const out: WorkSettings = {
    ...k.kinds,
    currency: k.currency,
    roundingMinutes: k.rounding,
    fromSite: k.fromSite,
    site: k.site,
    canSetSite: isSuperAdmin(c.env, requireUser(c)) && access.setup
  };
  return c.json(out);
});

projectRoutes.put("/companies/:id/settings", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetupTime(access);
  const b = await readJson(c);
  if (typeof b.projects !== "boolean" || typeof b.shifts !== "boolean") throw new HttpError(400, "Say whether Projects and Shifts are on.");
  if (!b.projects && !b.shifts) throw new HttpError(400, "Turn on Projects, Shifts or both. To stop using WorkSpent, turn the app off in Company settings.");
  const currency = oneOf(b.currency ?? "USD", "Currency", CURRENCIES);
  const rounding = Number(b.roundingMinutes ?? 0);
  if (!(ROUNDING as readonly number[]).includes(rounding)) throw new HttpError(400, "Rounding must be 0, 6 or 15 minutes.");
  await c.env.DB.prepare(
    `INSERT INTO workspent_settings (company_id, kinds_json, currency, rounding_minutes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (company_id) DO UPDATE SET kinds_json = excluded.kinds_json, currency = excluded.currency, rounding_minutes = excluded.rounding_minutes,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  )
    .bind(companyId, JSON.stringify({ projects: b.projects, shifts: b.shifts }), currency, rounding, access.userId, nowIso())
    .run();
  return c.json({ ok: true });
});

/** The site owner sets which kinds of work are on for companies that made no choice. */
projectRoutes.put("/companies/:id/site-kinds", async (c) => {
  const { access } = await ctx(c);
  if (!isSuperAdmin(c.env, requireUser(c)) || !access.setup)
    throw new HttpError(403, "Only the site owner sets the site default. Ask the person who runs this deploy.", "not_super_admin");
  const b = await readJson(c);
  if (typeof b.projects !== "boolean" || typeof b.shifts !== "boolean") throw new HttpError(400, "Say whether Projects and Shifts are on.");
  if (!b.projects && !b.shifts) throw new HttpError(400, "Turn on Projects, Shifts or both.");
  await c.env.DB.prepare(
    `INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  )
    .bind(SITE_KEY, JSON.stringify({ projects: b.projects, shifts: b.shifts }), access.userId, nowIso())
    .run();
  return c.json({ ok: true });
});

/* Clients ------------------------------------------------------------ */

interface ClientRow {
  id: string;
  name: string;
  approver_name: string;
  approver_email: string;
  rate_cents: number | null;
  is_archived: number;
}

const toClient = (r: ClientRow, setup: boolean): ClientInfo => ({
  id: r.id,
  name: r.name,
  approverName: r.approver_name,
  approverEmail: setup ? r.approver_email : "",
  hasApprover: !!r.approver_email,
  // Client rates are for people who set up WorkSpent. Others see the amounts of their own time only.
  rateCents: setup ? r.rate_cents : null,
  isArchived: !!r.is_archived
});

async function clientRows(env: Env, companyId: string): Promise<ClientRow[]> {
  const r = await env.DB.prepare("SELECT id, name, approver_name, approver_email, rate_cents, is_archived FROM workspent_clients WHERE company_id = ? ORDER BY name COLLATE NOCASE")
    .bind(companyId)
    .all<ClientRow>();
  return r.results;
}

async function clientRow(env: Env, companyId: string, clientId: string): Promise<ClientRow> {
  const r = await env.DB.prepare("SELECT id, name, approver_name, approver_email, rate_cents, is_archived FROM workspent_clients WHERE id = ? AND company_id = ?")
    .bind(clientId, companyId)
    .first<ClientRow>();
  if (!r) throw new HttpError(404, "This client does not exist. It may belong to another company.");
  return r;
}

function rate(v: unknown): number | null {
  try {
    return centsFrom(v);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

function clientFields(b: Record<string, unknown>, partial: boolean) {
  const out: Partial<{
    name: string;
    approverName: string;
    approverEmail: string;
    rateCents: number | null;
    isArchived: boolean;
  }> = {};
  if (!partial || b.name !== undefined) out.name = text(b.name, "Name", { max: 120, required: true });
  if (!partial || b.approverName !== undefined) out.approverName = text(b.approverName, "Approver name", { max: 120 });
  if (!partial || b.approverEmail !== undefined) {
    const email = normalizeEmail(b.approverEmail ?? "");
    if (email && !isEmail(email)) throw new HttpError(400, "Enter a real email address for the approver, or leave it empty.");
    out.approverEmail = email;
  }
  if (!partial || b.rateCents !== undefined || b.rate !== undefined) out.rateCents = b.rateCents !== undefined ? rate(Number(b.rateCents) / 100) : rate(b.rate);
  if (b.isArchived !== undefined) out.isArchived = !!b.isArchived;
  return out;
}

projectRoutes.get("/companies/:id/clients", async (c) => {
  const { companyId, access } = await ctx(c);
  if (!access.track && !access.setup && !access.manageAll) throw deny("Log time on projects");
  const rows = await clientRows(c.env, companyId);
  return c.json({ clients: rows.map((r) => toClient(r, access.setup)) });
});

projectRoutes.post("/companies/:id/clients", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetupTime(access);
  const f = clientFields(await readJson(c), false);
  const id = newId();
  const iso = nowIso();
  await c.env.DB.prepare("INSERT INTO workspent_clients (id, company_id, name, approver_name, approver_email, rate_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, companyId, f.name!, f.approverName ?? "", f.approverEmail ?? "", f.rateCents ?? null, iso, iso)
    .run();
  return c.json({ client: toClient(await clientRow(c.env, companyId, id), true) }, 201);
});

projectRoutes.patch("/companies/:id/clients/:cid", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetupTime(access);
  const cid = idParam(c, "cid", "client");
  const cur = await clientRow(c.env, companyId, cid);
  const f = clientFields(await readJson(c), true);
  await c.env.DB.prepare(
    "UPDATE workspent_clients SET name = ?, approver_name = ?, approver_email = ?, rate_cents = ?, is_archived = ?, updated_at = ? WHERE id = ? AND company_id = ?"
  )
    .bind(
      f.name ?? cur.name,
      f.approverName ?? cur.approver_name,
      f.approverEmail ?? cur.approver_email,
      f.rateCents !== undefined ? f.rateCents : cur.rate_cents,
      f.isArchived !== undefined ? (f.isArchived ? 1 : 0) : cur.is_archived,
      nowIso(),
      cid,
      companyId
    )
    .run();
  return c.json({
    client: toClient(await clientRow(c.env, companyId, cid), true)
  });
});

/* Projects ------------------------------------------------------------ */

interface ProjectSettingsRow {
  project_id: string;
  client_id: string | null;
  rate_cents: number | null;
  budget_minutes: number | null;
  is_billable: number;
  is_tracked: number;
}

async function projectInfos(env: Env, companyId: string, userId: string, onlyTracked: boolean): Promise<ProjectInfo[]> {
  const visible = await visibleFor(env, companyId, userId);
  if (!visible.length) return [];
  const marks = visible.map(() => "?").join(", ");
  const ids = visible.map((p) => p.id);
  const [settings, used] = await Promise.all([
    env.DB.prepare(`SELECT project_id, client_id, rate_cents, budget_minutes, is_billable, is_tracked FROM workspent_projects WHERE company_id = ? AND project_id IN (${marks})`)
      .bind(companyId, ...ids)
      .all<ProjectSettingsRow>(),
    env.DB.prepare(`SELECT project_id, SUM(minutes) AS m FROM workspent_entries WHERE company_id = ? AND project_id IN (${marks}) GROUP BY project_id`)
      .bind(companyId, ...ids)
      .all<{ project_id: string; m: number }>()
  ]);
  const byId = new Map(settings.results.map((s) => [s.project_id, s]));
  const usedBy = new Map(used.results.map((u) => [u.project_id, u.m]));
  return visible
    .map((p) => {
      const s = byId.get(p.id);
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        clientId: s?.client_id ?? null,
        rateCents: s?.rate_cents ?? null,
        budgetMinutes: s?.budget_minutes ?? null,
        isBillable: s ? !!s.is_billable : true,
        isTracked: s ? !!s.is_tracked : true,
        usedMinutes: usedBy.get(p.id) ?? 0
      };
    })
    .filter((p) => !onlyTracked || p.isTracked);
}

/** A project the person can see, with its WorkSpent settings. 404 for any other id. */
async function visibleProject(env: Env, companyId: string, userId: string, projectId: unknown): Promise<ProjectInfo> {
  if (typeof projectId !== "string" || !projectId) throw new HttpError(400, "Pick a project.");
  const p = (await projectInfos(env, companyId, userId, false)).find((x) => x.id === projectId);
  if (!p) throw new HttpError(404, "This project does not exist, or you cannot see it in the Projects app.");
  return p;
}

projectRoutes.get("/companies/:id/projects", async (c) => {
  const { companyId, access } = await ctx(c);
  if (!access.track && !access.setup) throw deny("Log time on projects");
  const projects = await projectInfos(c.env, companyId, access.userId, !access.setup);
  // Project rates are for people who set up WorkSpent.
  if (!access.setup) for (const p of projects) p.rateCents = null;
  return c.json({ projects, projectsApp: await projectsAppOn(c.env, companyId) });
});

projectRoutes.put("/companies/:id/projects/:pid", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetupTime(access);
  const pid = idParam(c, "pid", "project");
  const p = await visibleProject(c.env, companyId, access.userId, pid);
  const b = await readJson(c);
  let clientId: string | null = b.clientId === undefined ? p.clientId : (b.clientId as string | null) || null;
  if (clientId) clientId = (await clientRow(c.env, companyId, clientId)).id;
  const rateCents = b.rate !== undefined ? rate(b.rate) : p.rateCents;
  let budget = p.budgetMinutes;
  if (b.budgetHours !== undefined) {
    if (b.budgetHours === null || b.budgetHours === "") budget = null;
    else {
      const h = Number(b.budgetHours);
      if (!Number.isFinite(h) || h <= 0 || h > 100_000) throw new HttpError(400, "Enter a budget of more than 0 hours, or leave it empty.");
      budget = Math.round(h * 60);
    }
  }
  const billable = b.isBillable === undefined ? p.isBillable : !!b.isBillable;
  const tracked = b.isTracked === undefined ? p.isTracked : !!b.isTracked;
  const iso = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO workspent_projects (project_id, company_id, client_id, rate_cents, budget_minutes, is_billable, is_tracked, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET client_id = excluded.client_id, rate_cents = excluded.rate_cents, budget_minutes = excluded.budget_minutes,
         is_billable = excluded.is_billable, is_tracked = excluded.is_tracked, updated_at = excluded.updated_at
       WHERE workspent_projects.company_id = excluded.company_id`
    ).bind(pid, companyId, clientId, rateCents, budget, billable ? 1 : 0, tracked ? 1 : 0, iso),
    // Hours that no one approved yet move to the new client. Approved hours keep theirs.
    c.env.DB.prepare(
      `UPDATE workspent_entries SET client_id = ?, updated_at = ? WHERE company_id = ? AND project_id = ? AND rate_cents IS NULL
         AND NOT EXISTS (SELECT 1 FROM workspent_weeks w WHERE w.company_id = workspent_entries.company_id AND w.user_id = workspent_entries.user_id
           AND w.week_start_date = workspent_entries.week_start_date AND COALESCE(w.client_id, '') = COALESCE(workspent_entries.client_id, '') AND w.status = 'approved')`
    ).bind(clientId, iso, companyId, pid)
  ]);
  return c.json({
    project: await visibleProject(c.env, companyId, access.userId, pid)
  });
});

projectRoutes.get("/companies/:id/projects/:pid/tasks", async (c) => {
  const { companyId, access } = await ctx(c);
  requireTrack(access);
  const pid = idParam(c, "pid", "project");
  await visibleProject(c.env, companyId, access.userId, pid);
  const svc = projectsService();
  return c.json({ tasks: svc ? await svc.projectTasks(c.env, pid) : [] });
});

/* Team ------------------------------------------------------------ */

projectRoutes.get("/companies/:id/team", async (c) => {
  const { companyId, access } = await ctx(c);
  if (!access.setup && !access.manageAll) throw deny("Manage hours");
  const r = await c.env.DB.prepare(
    `SELECT u.id AS user_id, u.name, u.email, cm.role, wm.kind, wm.rate_cents, wm.weekly_minutes
     FROM company_members cm JOIN users u ON u.id = cm.user_id
     LEFT JOIN workspent_members wm ON wm.company_id = cm.company_id AND wm.user_id = cm.user_id
     WHERE cm.company_id = ? ORDER BY u.name COLLATE NOCASE`
  )
    .bind(companyId)
    .all<{
      user_id: string;
      name: string;
      email: string;
      role: string;
      kind: MemberKind | null;
      rate_cents: number | null;
      weekly_minutes: number | null;
    }>();
  const members: MemberInfo[] = r.results.map((m) => ({
    userId: m.user_id,
    name: m.name,
    email: m.email,
    role: m.role,
    kind: m.kind ?? (m.role === "guest" ? "freelancer" : "staff"),
    rateCents: m.rate_cents,
    weeklyMinutes: m.weekly_minutes
  }));
  return c.json({ members });
});

projectRoutes.put("/companies/:id/team/:uid", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetupTime(access);
  const uid = c.req.param("uid") ?? "";
  const member = await c.env.DB.prepare("SELECT role FROM company_members WHERE company_id = ? AND user_id = ?").bind(companyId, uid).first<{ role: string }>();
  if (!member) throw new HttpError(404, "This person is not in the company.");
  const b = await readJson(c);
  const kind = oneOf(b.kind ?? "staff", "Kind", MEMBER_KINDS);
  const rateCents = rate(b.rate);
  let weekly: number | null = null;
  if (b.weeklyHours !== undefined && b.weeklyHours !== null && b.weeklyHours !== "") {
    const h = Number(b.weeklyHours);
    if (!Number.isFinite(h) || h < 0 || h > 168) throw new HttpError(400, "Enter the hours planned each week, from 0 to 168.");
    weekly = Math.round(h * 60);
  }
  await c.env.DB.prepare(
    `INSERT INTO workspent_members (company_id, user_id, kind, rate_cents, weekly_minutes, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (company_id, user_id) DO UPDATE SET kind = excluded.kind, rate_cents = excluded.rate_cents, weekly_minutes = excluded.weekly_minutes, updated_at = excluded.updated_at`
  )
    .bind(companyId, uid, kind, rateCents, weekly, nowIso())
    .run();
  return c.json({ ok: true });
});

/* Entries ------------------------------------------------------------ */

const ENTRY_SELECT = `SELECT e.id, e.user_id, e.project_id, e.task_id, e.client_id, e.work_date, e.week_start_date, e.minutes, e.timer_started_ms, e.note,
    e.is_billable, e.rate_cents, p.name AS project_name, t.title AS task_title, cl.name AS client_name, u.name AS user_name,
    COALESCE(e.rate_cents, wp.rate_cents, cl.rate_cents, wm.rate_cents) AS live_rate,
    (SELECT w.status FROM workspent_weeks w WHERE w.company_id = e.company_id AND w.user_id = e.user_id AND w.week_start_date = e.week_start_date
       AND COALESCE(w.client_id, '') = COALESCE(e.client_id, '')) AS week_status
  FROM workspent_entries e
  LEFT JOIN projects p ON p.id = e.project_id AND p.company_id = e.company_id
  LEFT JOIN tasks t ON t.id = e.task_id AND t.project_id = e.project_id
  LEFT JOIN workspent_clients cl ON cl.id = e.client_id AND cl.company_id = e.company_id
  LEFT JOIN workspent_projects wp ON wp.project_id = e.project_id AND wp.company_id = e.company_id
  LEFT JOIN workspent_members wm ON wm.company_id = e.company_id AND wm.user_id = e.user_id
  LEFT JOIN users u ON u.id = e.user_id`;

interface EntryRow {
  id: string;
  user_id: string;
  project_id: string;
  task_id: string | null;
  client_id: string | null;
  work_date: string;
  week_start_date: string;
  minutes: number;
  timer_started_ms: number | null;
  note: string;
  is_billable: number;
  rate_cents: number | null;
  project_name: string | null;
  task_title: string | null;
  client_name: string | null;
  user_name: string | null;
  live_rate: number | null;
  week_status: WeekStatus | null;
}

const toEntry = (r: EntryRow): EntryInfo => ({
  id: r.id,
  userId: r.user_id,
  projectId: r.project_id,
  projectName: r.project_name ?? "Deleted project",
  taskId: r.task_id,
  taskName: r.task_title ?? "",
  clientId: r.client_id,
  clientName: r.client_name ?? "",
  date: r.work_date,
  minutes: r.minutes,
  timerStartedAt: r.timer_started_ms === null ? null : new Date(r.timer_started_ms).toISOString(),
  note: r.note,
  billable: !!r.is_billable,
  rateCents: r.live_rate,
  status: r.week_status ?? "open"
});

async function entryRows(env: Env, companyId: string, where: string, ...binds: unknown[]): Promise<EntryRow[]> {
  const r = await env.DB.prepare(`${ENTRY_SELECT} WHERE e.company_id = ? AND ${where} ORDER BY e.work_date, e.created_at`)
    .bind(companyId, ...binds)
    .all<EntryRow>();
  return r.results;
}

async function ownEntry(env: Env, companyId: string, a: Access, eid: string): Promise<EntryRow> {
  const [r] = await entryRows(env, companyId, "e.id = ?", eid);
  if (!r || r.user_id !== a.userId) throw new HttpError(404, "This time entry does not exist, or it is not yours.");
  return r;
}

/** The status of one part of a person's week. */
async function partStatus(env: Env, companyId: string, userId: string, week: string, clientId: string | null): Promise<WeekStatus | null> {
  const r = await env.DB.prepare("SELECT status FROM workspent_weeks WHERE company_id = ? AND user_id = ? AND week_start_date = ? AND COALESCE(client_id, '') = ?")
    .bind(companyId, userId, week, clientId ?? "")
    .first<{ status: WeekStatus }>();
  return r?.status ?? null;
}

/** Refuses a change to approved hours. A change to sent hours takes the part back, so the person sends it again. */
async function unlockPart(env: Env, companyId: string, userId: string, week: string, clientId: string | null): Promise<D1PreparedStatement[]> {
  const s = await partStatus(env, companyId, userId, week, clientId);
  if (s === "approved") throw new HttpError(409, "These hours are approved, so they are locked. Ask a company owner or admin to reopen the week.", "approved");
  if (s !== "sent") return [];
  return [
    env.DB.prepare("DELETE FROM workspent_weeks WHERE company_id = ? AND user_id = ? AND week_start_date = ? AND COALESCE(client_id, '') = ? AND status = 'sent'").bind(
      companyId,
      userId,
      week,
      clientId ?? ""
    )
  ];
}

function minutesOf(v: unknown): number {
  const m = Number(v);
  if (!Number.isInteger(m) || m < 1 || m > MAX_ENTRY_MINUTES) throw new HttpError(400, "Enter from 1 minute to 24 hours.");
  return m;
}

async function taskOf(env: Env, projectId: string, v: unknown): Promise<string | null> {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new HttpError(400, "Pick a task of this project.");
  const t = await env.DB.prepare("SELECT id FROM tasks WHERE id = ? AND project_id = ?").bind(v, projectId).first<{ id: string }>();
  if (!t) throw new HttpError(400, "Pick a task of this project.");
  return t.id;
}

async function trackable(env: Env, companyId: string, userId: string, projectId: unknown): Promise<ProjectInfo> {
  const p = await visibleProject(env, companyId, userId, projectId);
  if (!p.isTracked) throw new HttpError(400, "This project does not track time. A company owner or admin can change it in Clients and projects.");
  return p;
}

projectRoutes.post("/companies/:id/entries", async (c) => {
  const { companyId, access } = await ctx(c);
  requireTrack(access);
  const k = await requireProjectsOn(c.env, companyId);
  const b = await readJson(c);
  const p = await trackable(c.env, companyId, access.userId, b.projectId);
  if (!isDate(b.date)) throw new HttpError(400, "Pick a date.");
  const minutes = roundMinutes(minutesOf(b.minutes), k.rounding);
  const taskId = await taskOf(c.env, p.id, b.taskId);
  const week = weekStart(b.date);
  const unlock = await unlockPart(c.env, companyId, access.userId, week, p.clientId);
  const id = newId();
  const iso = nowIso();
  await c.env.DB.batch([
    ...unlock,
    c.env.DB.prepare(
      `INSERT INTO workspent_entries (id, company_id, user_id, project_id, task_id, client_id, work_date, week_start_date, minutes, note, is_billable, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      companyId,
      access.userId,
      p.id,
      taskId,
      p.clientId,
      b.date,
      week,
      minutes,
      text(b.note, "Note", { max: 500 }),
      p.isBillable && b.billable !== false ? 1 : 0,
      iso,
      iso
    )
  ]);
  return c.json({ entry: toEntry(await ownEntry(c.env, companyId, access, id)) }, 201);
});

projectRoutes.patch("/companies/:id/entries/:eid", async (c) => {
  const { companyId, access } = await ctx(c);
  requireTrack(access);
  const k = await requireProjectsOn(c.env, companyId);
  const cur = await ownEntry(c.env, companyId, access, idParam(c, "eid", "time entry"));
  const b = await readJson(c);
  const p = b.projectId !== undefined && b.projectId !== cur.project_id ? await trackable(c.env, companyId, access.userId, b.projectId) : null;
  const projectId = p?.id ?? cur.project_id;
  const clientId = p ? p.clientId : cur.client_id;
  const date =
    b.date !== undefined
      ? isDate(b.date)
        ? b.date
        : (() => {
            throw new HttpError(400, "Pick a date.");
          })()
      : cur.work_date;
  const week = weekStart(date);
  if (cur.timer_started_ms !== null && (b.minutes !== undefined || b.date !== undefined)) throw new HttpError(409, "Stop the timer first. Then change the time.");
  const minutes = b.minutes !== undefined ? roundMinutes(minutesOf(b.minutes), k.rounding) : cur.minutes;
  const taskId = b.taskId !== undefined || p ? await taskOf(c.env, projectId, b.taskId) : cur.task_id;
  const note = b.note !== undefined ? text(b.note, "Note", { max: 500 }) : cur.note;
  const billable = b.billable !== undefined ? !!b.billable : !!cur.is_billable;
  const unlock = [
    ...(await unlockPart(c.env, companyId, access.userId, cur.week_start_date, cur.client_id)),
    ...(week !== cur.week_start_date || clientId !== cur.client_id ? await unlockPart(c.env, companyId, access.userId, week, clientId) : [])
  ];
  await c.env.DB.batch([
    ...unlock,
    c.env.DB.prepare(
      `UPDATE workspent_entries SET project_id = ?, task_id = ?, client_id = ?, work_date = ?, week_start_date = ?, minutes = ?, note = ?, is_billable = ?, updated_at = ?
       WHERE id = ? AND company_id = ? AND user_id = ?`
    ).bind(projectId, taskId, clientId, date, week, minutes, note, billable ? 1 : 0, nowIso(), cur.id, companyId, access.userId)
  ]);
  return c.json({
    entry: toEntry(await ownEntry(c.env, companyId, access, cur.id))
  });
});

projectRoutes.delete("/companies/:id/entries/:eid", async (c) => {
  const { companyId, access } = await ctx(c);
  requireTrack(access);
  const cur = await ownEntry(c.env, companyId, access, idParam(c, "eid", "time entry"));
  const unlock = await unlockPart(c.env, companyId, access.userId, cur.week_start_date, cur.client_id);
  await c.env.DB.batch([...unlock, c.env.DB.prepare("DELETE FROM workspent_entries WHERE id = ? AND company_id = ? AND user_id = ?").bind(cur.id, companyId, access.userId)]);
  return c.json({ ok: true });
});

/* Timer ------------------------------------------------------------ */

async function runningRow(env: Env, companyId: string, userId: string): Promise<EntryRow | null> {
  const [r] = await entryRows(env, companyId, "e.user_id = ? AND e.timer_started_ms IS NOT NULL", userId);
  return r ?? null;
}

/** Stops a running timer: its minutes grow by the time it ran. Under a minute in all, the entry goes away. */
async function stopStatements(env: Env, companyId: string, userId: string, rounding: number, nowMs: number): Promise<D1PreparedStatement[]> {
  const run = await runningRow(env, companyId, userId);
  if (!run) return [];
  const total = Math.min(MAX_ENTRY_MINUTES, run.minutes + timerMinutes(run.timer_started_ms!, nowMs));
  if (total < 1) return [env.DB.prepare("DELETE FROM workspent_entries WHERE id = ? AND company_id = ?").bind(run.id, companyId)];
  return [
    env.DB.prepare("UPDATE workspent_entries SET minutes = ?, timer_started_ms = NULL, updated_at = ? WHERE id = ? AND company_id = ?").bind(
      roundMinutes(total, rounding),
      nowIso(),
      run.id,
      companyId
    )
  ];
}

projectRoutes.post("/companies/:id/timer/start", async (c) => {
  const { companyId, access } = await ctx(c);
  requireTrack(access);
  const k = await requireProjectsOn(c.env, companyId);
  const b = await readJson(c);
  const p = await trackable(c.env, companyId, access.userId, b.projectId);
  if (!isDate(b.date)) throw new HttpError(400, "Send today's date from your device.");
  const taskId = await taskOf(c.env, p.id, b.taskId);
  const week = weekStart(b.date);
  const now = Date.now();
  const stop = await stopStatements(c.env, companyId, access.userId, k.rounding, now);
  const unlock = await unlockPart(c.env, companyId, access.userId, week, p.clientId);
  const id = newId();
  const iso = nowIso();
  await c.env.DB.batch([
    ...stop,
    ...unlock,
    c.env.DB.prepare(
      `INSERT INTO workspent_entries (id, company_id, user_id, project_id, task_id, client_id, work_date, week_start_date, minutes, timer_started_ms, note, is_billable, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    ).bind(id, companyId, access.userId, p.id, taskId, p.clientId, b.date, week, now, text(b.note, "Note", { max: 500 }), p.isBillable && b.billable !== false ? 1 : 0, iso, iso)
  ]);
  return c.json({ entry: toEntry(await ownEntry(c.env, companyId, access, id)) }, 201);
});

projectRoutes.post("/companies/:id/timer/stop", async (c) => {
  const { companyId, access } = await ctx(c);
  requireTrack(access);
  const k = await companyKinds(c.env, companyId);
  const stop = await stopStatements(c.env, companyId, access.userId, k.rounding, Date.now());
  if (!stop.length) throw new HttpError(409, "No timer is running.", "no_timer");
  await c.env.DB.batch(stop);
  return c.json({ ok: true });
});

/* Weeks ------------------------------------------------------------ */

interface WeekRow {
  id: string;
  client_id: string | null;
  status: WeekStatus;
  note: string;
  sent_at: string | null;
  decided_at: string | null;
  decided_name: string | null;
  is_client_decision: number;
}

async function weekRows(env: Env, companyId: string, userId: string, week: string): Promise<WeekRow[]> {
  const r = await env.DB.prepare(
    `SELECT w.id, w.client_id, w.status, w.note, w.sent_at, w.decided_at, u.name AS decided_name, w.is_client_decision
     FROM workspent_weeks w LEFT JOIN users u ON u.id = w.decided_by WHERE w.company_id = ? AND w.user_id = ? AND w.week_start_date = ?`
  )
    .bind(companyId, userId, week)
    .all<WeekRow>();
  return r.results;
}

/** The parts of a week: one per client with hours, and one for hours with no client. */
async function weekParts(env: Env, companyId: string, userId: string, week: string, entries: EntryInfo[]): Promise<WeekPart[]> {
  const [rows, clients] = await Promise.all([weekRows(env, companyId, userId, week), clientRows(env, companyId)]);
  const keys = new Set<string>([...entries.map((e) => e.clientId ?? ""), ...rows.map((r) => r.client_id ?? "")]);
  return [...keys]
    .map((key): WeekPart => {
      const mine = entries.filter((e) => (e.clientId ?? "") === key);
      const row = rows.find((r) => (r.client_id ?? "") === key);
      const client = clients.find((c) => c.id === key);
      return {
        clientId: key || null,
        clientName: client?.name ?? "No client",
        minutes: mine.reduce((s, e) => s + e.minutes, 0),
        cents: mine.reduce(
          (s, e) =>
            s +
            entryCents({
              billable: e.billable,
              minutes: e.minutes,
              rateCents: e.rateCents
            }),
          0
        ),
        status: row?.status ?? "open",
        note: row?.note ?? "",
        decidedBy: row ? (row.is_client_decision ? client?.approver_name || "The client" : (row.decided_name ?? "")) : "",
        decidedAt: row?.decided_at ?? null,
        sentAt: row?.sent_at ?? null,
        hasApprover: !!client?.approver_email
      };
    })
    .sort((a, b) => b.minutes - a.minutes);
}

function weekParam(c: Context<AppEnv>, v: string | undefined): string {
  if (!isDate(v)) throw new HttpError(400, "Give the week as a date, YYYY-MM-DD.");
  return weekStart(v);
}

async function personName(env: Env, companyId: string, userId: string): Promise<string> {
  const r = await env.DB.prepare("SELECT u.name FROM company_members cm JOIN users u ON u.id = cm.user_id WHERE cm.company_id = ? AND cm.user_id = ?")
    .bind(companyId, userId)
    .first<{ name: string }>();
  if (!r) throw new HttpError(404, "This person is not in the company.");
  return r.name;
}

projectRoutes.get("/companies/:id/my-projects", async (c) => {
  const { companyId, access } = await ctx(c);
  requireTrack(access);
  const k = await companyKinds(c.env, companyId);
  const week = weekParam(c, c.req.query("week"));
  const [rows, run, projects, clients, member, appOn] = await Promise.all([
    entryRows(c.env, companyId, "e.user_id = ? AND e.week_start_date = ?", access.userId, week),
    runningRow(c.env, companyId, access.userId),
    projectInfos(c.env, companyId, access.userId, true),
    clientRows(c.env, companyId),
    c.env.DB.prepare("SELECT weekly_minutes FROM workspent_members WHERE company_id = ? AND user_id = ?").bind(companyId, access.userId).first<{ weekly_minutes: number | null }>(),
    projectsAppOn(c.env, companyId)
  ]);
  const entries = rows.map(toEntry);
  const out: MyProjectTime = {
    currency: k.currency,
    roundingMinutes: k.rounding,
    week,
    running: run ? toEntry(run) : null,
    entries,
    parts: await weekParts(c.env, companyId, access.userId, week, entries),
    weeklyMinutes: member?.weekly_minutes ?? null,
    projects: projects.map((p) => ({ ...p, rateCents: access.setup ? p.rateCents : null })),
    clients: clients.filter((x) => !x.is_archived).map((x) => toClient(x, access.setup)),
    projectsApp: appOn
  };
  return c.json(out);
});

projectRoutes.get("/companies/:id/time-log", async (c) => {
  const { companyId, access } = await ctx(c);
  if (!access.track && !access.manageAll) throw deny("Log time on projects");
  const k = await companyKinds(c.env, companyId);
  const week = weekParam(c, c.req.query("week"));
  const asked = c.req.query("userId") || access.userId;
  if (asked !== access.userId && !access.manageAll) throw deny("Manage hours");
  const name = await personName(c.env, companyId, asked);
  const entries = (await entryRows(c.env, companyId, "e.user_id = ? AND e.week_start_date = ?", asked, week)).map(toEntry);
  let people: WeekPerson[] = [];
  if (access.manageAll) {
    const all = await c.env.DB.prepare(
      `SELECT cm.user_id, u.name, wm.kind, cm.role,
         (SELECT COALESCE(SUM(minutes), 0) FROM workspent_entries e WHERE e.company_id = cm.company_id AND e.user_id = cm.user_id AND e.week_start_date = ?) AS minutes
       FROM company_members cm JOIN users u ON u.id = cm.user_id LEFT JOIN workspent_members wm ON wm.company_id = cm.company_id AND wm.user_id = cm.user_id
       WHERE cm.company_id = ? ORDER BY u.name COLLATE NOCASE`
    )
      .bind(week, companyId)
      .all<{
        user_id: string;
        name: string;
        kind: MemberKind | null;
        role: string;
        minutes: number;
      }>();
    const weeks = await c.env.DB.prepare("SELECT user_id, client_id, status FROM workspent_weeks WHERE company_id = ? AND week_start_date = ?")
      .bind(companyId, week)
      .all<{ user_id: string; client_id: string | null; status: WeekStatus }>();
    const parts = await c.env.DB.prepare("SELECT DISTINCT user_id, client_id FROM workspent_entries WHERE company_id = ? AND week_start_date = ?")
      .bind(companyId, week)
      .all<{ user_id: string; client_id: string | null }>();
    people = all.results
      .filter((m) => m.minutes > 0 || m.user_id === asked)
      .map((m) => {
        const keys = new Set([...parts.results.filter((p) => p.user_id === m.user_id).map((p) => p.client_id ?? "")]);
        const statuses = [...keys].map((key) => ({
          status: weeks.results.find((w) => w.user_id === m.user_id && (w.client_id ?? "") === key)?.status ?? ("open" as const)
        }));
        return {
          userId: m.user_id,
          name: m.name,
          kind: m.kind ?? (m.role === "guest" ? "freelancer" : "staff"),
          minutes: m.minutes,
          status: weekStatus(statuses)
        };
      });
  }
  const out: TimeLogData = {
    week,
    dates: weekDates(week),
    currency: k.currency,
    userId: asked,
    personName: name,
    canManage: access.manageAll,
    isSelf: asked === access.userId,
    people,
    entries,
    parts: await weekParts(c.env, companyId, asked, week, entries)
  };
  return c.json(out);
});

/** The person sends every part of their week that is not approved. */
projectRoutes.post("/companies/:id/weeks/:week/send", async (c) => {
  const { companyId, access } = await ctx(c);
  requireTrack(access);
  const week = weekParam(c, c.req.param("week"));
  const entries = (await entryRows(c.env, companyId, "e.user_id = ? AND e.week_start_date = ?", access.userId, week)).map(toEntry);
  if (entries.some((e) => e.timerStartedAt)) throw new HttpError(409, "Stop the timer first. Then send the week.");
  const parts = (await weekParts(c.env, companyId, access.userId, week, entries)).filter((p) => p.minutes > 0 && p.status !== "approved" && p.status !== "sent");
  if (!parts.length) throw new HttpError(409, "There are no hours to send for this week.");
  const iso = nowIso();
  await c.env.DB.batch(
    parts.map((p) =>
      c.env.DB.prepare(
        `INSERT INTO workspent_weeks (id, company_id, user_id, week_start_date, client_id, status, note, sent_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'sent', '', ?, ?, ?)
         ON CONFLICT (company_id, user_id, week_start_date, COALESCE(client_id, '')) DO UPDATE SET status = 'sent', note = '', sent_at = excluded.sent_at,
           decided_at = NULL, decided_by = NULL, is_client_decision = 0, link_hash = NULL, link_expires_ms = NULL, updated_at = excluded.updated_at`
      ).bind(newId(), companyId, access.userId, week, p.clientId, iso, iso, iso)
    )
  );
  return c.json({ sent: parts.length });
});

interface PartRow {
  id: string;
  user_id: string;
  client_id: string | null;
  week_start_date: string;
  status: WeekStatus;
}

async function partRow(env: Env, companyId: string, userId: unknown, week: string, clientId: unknown): Promise<PartRow> {
  if (typeof userId !== "string") throw new HttpError(400, "Pick a person.");
  const key = typeof clientId === "string" ? clientId : "";
  const r = await env.DB.prepare(
    "SELECT id, user_id, client_id, week_start_date, status FROM workspent_weeks WHERE company_id = ? AND user_id = ? AND week_start_date = ? AND COALESCE(client_id, '') = ?"
  )
    .bind(companyId, userId, week, key)
    .first<PartRow>();
  if (!r) throw new HttpError(404, "This part of the week was not sent. The person sends it from My time.");
  return r;
}

/** Saves the rate on each entry of an approved part, so a later rate change does not change approved amounts. */
function freezeRates(env: Env, companyId: string, p: PartRow): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE workspent_entries SET rate_cents = COALESCE(
       (SELECT rate_cents FROM workspent_projects wp WHERE wp.project_id = workspent_entries.project_id AND wp.company_id = workspent_entries.company_id),
       (SELECT rate_cents FROM workspent_clients cl WHERE cl.id = workspent_entries.client_id AND cl.company_id = workspent_entries.company_id),
       (SELECT rate_cents FROM workspent_members wm WHERE wm.company_id = workspent_entries.company_id AND wm.user_id = workspent_entries.user_id)), updated_at = ?
     WHERE company_id = ? AND user_id = ? AND week_start_date = ? AND COALESCE(client_id, '') = ?`
  ).bind(nowIso(), companyId, p.user_id, p.week_start_date, p.client_id ?? "");
}

projectRoutes.post("/companies/:id/weeks/:week/decide", async (c) => {
  const { companyId, access } = await ctx(c);
  requireManageTime(access);
  const week = weekParam(c, c.req.param("week"));
  const b = await readJson(c);
  const action = oneOf(b.action, "Action", ["approve", "return"] as const);
  if (b.userId === access.userId) throw new HttpError(403, "You cannot approve or return your own hours. Ask another manager, or a company owner or admin.", "own_hours");
  const part = await partRow(c.env, companyId, b.userId, week, b.clientId);
  if (part.status !== "sent") throw new HttpError(409, "Only hours that the person sent can be approved or returned.");
  const iso = nowIso();
  if (action === "approve") {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE workspent_weeks SET status = 'approved', note = '', decided_at = ?, decided_by = ?, is_client_decision = 0, link_hash = NULL, link_expires_ms = NULL, updated_at = ? WHERE id = ? AND company_id = ?"
      ).bind(iso, access.userId, iso, part.id, companyId),
      freezeRates(c.env, companyId, part)
    ]);
  } else {
    const note = text(b.note, "A note for the person", {
      max: 500,
      required: true
    });
    await c.env.DB.prepare(
      "UPDATE workspent_weeks SET status = 'returned', note = ?, decided_at = ?, decided_by = ?, is_client_decision = 0, link_hash = NULL, link_expires_ms = NULL, updated_at = ? WHERE id = ? AND company_id = ?"
    )
      .bind(note, iso, access.userId, iso, part.id, companyId)
      .run();
  }
  return c.json({ ok: true });
});

/** A manager sends the client's approver a link to approve their part of the week. */
projectRoutes.post("/companies/:id/weeks/:week/link", async (c) => {
  const { companyId, access } = await ctx(c);
  requireManageTime(access);
  const week = weekParam(c, c.req.param("week"));
  const b = await readJson(c);
  if (b.userId === access.userId) throw new HttpError(403, "You cannot send your own hours for approval this way. Use Send week on My time.", "own_hours");
  if (typeof b.clientId !== "string" || !b.clientId) throw new HttpError(400, "Pick a client.");
  const part = await partRow(c.env, companyId, b.userId, week, b.clientId);
  if (part.status !== "sent") throw new HttpError(409, "Only hours that the person sent can go to the client.");
  const client = await clientRow(c.env, companyId, b.clientId);
  if (!client.approver_email) throw new HttpError(400, "This client has no approver email. Add one in Clients and projects, or approve the hours yourself.");
  const token = randomToken();
  const expires = Date.now() + LINK_DAYS * 86_400_000;
  await c.env.DB.prepare("UPDATE workspent_weeks SET link_hash = ?, link_expires_ms = ?, updated_at = ? WHERE id = ? AND company_id = ?")
    .bind(await sha256Hex(token), expires, nowIso(), part.id, companyId)
    .run();
  const url = `${new URL(c.req.url).origin}${APPROVE_PATH}#t=${token}`;
  const [person, company] = await Promise.all([
    personName(c.env, companyId, part.user_id),
    c.env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(companyId).first<{ name: string }>()
  ]);
  const heading = `Approve hours for ${client.name}`;
  const body = `${person} worked for ${client.name} in the week of ${week}. Check the hours, then approve them. The link works for ${LINK_DAYS} days.`;
  const emailed = await sendEmail(c.env, {
    to: client.approver_email,
    subject: `${company?.name ?? "WorkSpent"}: ${heading}`,
    text: `${body}\n\n${url}\n`,
    html: emailLayout(c.env, heading, `<p style="margin:0 0 16px">${escapeHtml(body)}</p>${emailButton(url, "Check the hours")}`)
  });
  return c.json({ url, emailed });
});

/** An owner or admin reopens an approved or returned part. It goes back to sent. */
projectRoutes.post("/companies/:id/weeks/:week/reopen", async (c) => {
  const { companyId, access } = await ctx(c);
  requireSetupTime(access);
  const week = weekParam(c, c.req.param("week"));
  const b = await readJson(c);
  const part = await partRow(c.env, companyId, b.userId, week, b.clientId);
  if (part.status === "sent") throw new HttpError(409, "These hours are not approved yet.");
  const iso = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE workspent_weeks SET status = 'sent', note = '', decided_at = NULL, decided_by = NULL, is_client_decision = 0, link_hash = NULL, link_expires_ms = NULL, updated_at = ? WHERE id = ? AND company_id = ?"
    ).bind(iso, part.id, companyId),
    c.env.DB.prepare(
      "UPDATE workspent_entries SET rate_cents = NULL, updated_at = ? WHERE company_id = ? AND user_id = ? AND week_start_date = ? AND COALESCE(client_id, '') = ?"
    ).bind(iso, companyId, part.user_id, week, part.client_id ?? "")
  ]);
  return c.json({ ok: true });
});

/* Reports ------------------------------------------------------------ */

async function reportEntries(
  c: Context<AppEnv>,
  companyId: string,
  access: Access
): Promise<{
  from: string;
  to: string;
  groupBy: GroupBy;
  entries: ReportEntry[];
}> {
  const q = c.req.query();
  const problem = rangeProblem(q.from, q.to);
  if (problem) throw new HttpError(400, problem);
  const groupBy = oneOf(q.groupBy ?? "client", "Group by", GROUPS);
  let userId = q.userId || null;
  if (!access.manageAll) {
    if (!access.track) throw deny("Log time on projects");
    userId = access.userId;
  }
  const rows = await entryRows(
    c.env,
    companyId,
    `e.work_date BETWEEN ? AND ? AND e.timer_started_ms IS NULL${userId ? " AND e.user_id = ?" : ""}`,
    q.from,
    q.to,
    ...(userId ? [userId] : [])
  );
  const approvedOnly = q.status === "approved";
  const entries: ReportEntry[] = rows
    .map((r) => {
      const e = toEntry(r);
      return {
        date: e.date,
        personId: e.userId,
        personName: r.user_name ?? "Deleted account",
        clientId: e.clientId,
        clientName: e.clientName,
        projectId: e.projectId,
        projectName: e.projectName,
        taskName: e.taskName,
        note: e.note,
        minutes: e.minutes,
        billable: e.billable,
        rateCents: e.rateCents,
        status: e.status
      };
    })
    .filter((e) => !approvedOnly || e.status === "approved");
  return { from: q.from!, to: q.to!, groupBy, entries };
}

projectRoutes.get("/companies/:id/reports", async (c) => {
  const { companyId, access } = await ctx(c);
  const k = await companyKinds(c.env, companyId);
  const r = await reportEntries(c, companyId, access);
  const { groups, totals } = groupReport(r.entries, r.groupBy);
  const near = access.manageAll
    ? (await projectInfos(c.env, companyId, access.userId, false)).filter((p) => p.budgetMinutes && p.usedMinutes >= p.budgetMinutes * BUDGET_WARN).length
    : 0;
  const out: ReportData = {
    from: r.from,
    to: r.to,
    groupBy: r.groupBy,
    currency: k.currency,
    groups,
    totals,
    budgetsNearLimit: near
  };
  return c.json(out);
});

projectRoutes.get("/companies/:id/reports/export", async (c) => {
  const { companyId, access } = await ctx(c);
  const k = await companyKinds(c.env, companyId);
  const r = await reportEntries(c, companyId, access);
  return new Response(entryCsv(r.entries, k.currency), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="workspent-projects-${r.from}-to-${r.to}.csv"`,
      "Cache-Control": "no-store"
    }
  });
});

/* The client approval link (no sign-in) ------------------------------ */

interface LinkRow {
  id: string;
  company_id: string;
  user_id: string;
  client_id: string | null;
  week_start_date: string;
  status: WeekStatus;
  link_expires_ms: number | null;
}

async function linkPart(env: Env, token: unknown): Promise<LinkRow> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) throw new HttpError(404, "This link does not work. Ask for a new one.");
  const r = await env.DB.prepare("SELECT id, company_id, user_id, client_id, week_start_date, status, link_expires_ms FROM workspent_weeks WHERE link_hash = ?")
    .bind(await sha256Hex(token))
    .first<LinkRow>();
  if (!r || r.status !== "sent" || !r.link_expires_ms || r.link_expires_ms < Date.now())
    throw new HttpError(404, "This link does not work. It may be used or too old. Ask for a new one.");
  if (!(await companyAppState(env, r.company_id)).enabled("workspent")) throw new HttpError(404, "This link does not work. Ask for a new one.");
  return r;
}

approveRoutes.post("/view", async (c) => {
  const b = await readJson(c);
  const p = await linkPart(c.env, b.token);
  const k = await companyKinds(c.env, p.company_id);
  const rows = await entryRows(
    c.env,
    p.company_id,
    "e.user_id = ? AND e.week_start_date = ? AND COALESCE(e.client_id, '') = ? AND e.timer_started_ms IS NULL",
    p.user_id,
    p.week_start_date,
    p.client_id ?? ""
  );
  const [company, client, person] = await Promise.all([
    c.env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(p.company_id).first<{ name: string }>(),
    p.client_id ? clientRow(c.env, p.company_id, p.client_id) : null,
    c.env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(p.user_id).first<{ name: string }>()
  ]);
  const entries = rows.map((r) => {
    const e = toEntry(r);
    return {
      date: e.date,
      projectName: e.projectName,
      taskName: e.taskName,
      note: e.note,
      minutes: e.minutes,
      cents: entryCents(e)
    };
  });
  const out: ApprovalView = {
    companyName: company?.name ?? "",
    personName: person?.name ?? "",
    clientName: client?.name ?? "",
    week: p.week_start_date,
    currency: k.currency,
    status: p.status,
    entries,
    minutes: entries.reduce((s, e) => s + e.minutes, 0),
    cents: entries.reduce((s, e) => s + e.cents, 0)
  };
  return c.json(out);
});

approveRoutes.post("/decide", async (c) => {
  const b = await readJson(c);
  const p = await linkPart(c.env, b.token);
  const action = oneOf(b.action, "Action", ["approve", "question"] as const);
  const iso = nowIso();
  if (action === "approve") {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE workspent_weeks SET status = 'approved', note = '', decided_at = ?, decided_by = NULL, is_client_decision = 1, link_hash = NULL, link_expires_ms = NULL, updated_at = ? WHERE id = ? AND status = 'sent'"
      ).bind(iso, iso, p.id),
      freezeRates(c.env, p.company_id, p)
    ]);
  } else {
    const note = text(b.note, "Your question", { max: 500, required: true });
    await c.env.DB.prepare(
      "UPDATE workspent_weeks SET status = 'returned', note = ?, decided_at = ?, decided_by = NULL, is_client_decision = 1, link_hash = NULL, link_expires_ms = NULL, updated_at = ? WHERE id = ? AND status = 'sent'"
    )
      .bind(`Client question: ${note}`, iso, iso, p.id)
      .run();
  }
  return c.json({
    ok: true,
    status: action === "approve" ? "approved" : "returned"
  });
});

/** Every Projects row of a company, children first, for the companyDeleting hook. */
export const PROJECT_TABLES = ["workspent_weeks", "workspent_entries", "workspent_members", "workspent_projects", "workspent_clients", "workspent_settings"];
