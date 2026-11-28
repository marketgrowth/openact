import type { Env } from "./env.ts";
import {
  ALL_WORKSPACES,
  MAX_WORKSPACES_PER_COMPANY,
  WORKSPACE_KINDS,
  isHexColor,
  workspaceSlug,
  type CompanyRole,
  type Workspace,
  type WorkspaceColors,
  type WorkspaceKind
} from "../shared/types.ts";
import { HttpError, newId, nowIso, oneOf, text } from "./util.ts";

/*
 * Workspace rows and rules, without routes. workspaces.ts has the routes and the helpers for apps.
 * The imports use .ts names, so the tests can load this file with Node.
 */

type WorkspaceRow = {
  id: string;
  company_id: string;
  name: string;
  slug: string;
  kind: WorkspaceKind;
  is_default: number;
  logo_key: string | null;
  logo_updated_at: string | null;
  colors: string;
  website: string | null;
  archived_at: string | null;
};

const COLUMNS = "id, company_id, name, slug, kind, is_default, logo_key, logo_updated_at, colors, website, archived_at";

export const isManager = (role: CompanyRole | null) => role === "owner" || role === "admin";

function parseColors(json: string): WorkspaceColors {
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    const out: WorkspaceColors = {};
    if (typeof v.primary === "string" && isHexColor(v.primary)) out.primary = v.primary;
    if (typeof v.accent === "string" && isHexColor(v.accent)) out.accent = v.accent;
    return out;
  } catch {
    return {};
  }
}

export const toWorkspace = (r: WorkspaceRow): Workspace => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  slug: r.slug,
  kind: r.kind,
  isDefault: r.is_default === 1,
  logoUrl: r.logo_key ? `/api/companies/${r.company_id}/workspaces/${r.id}/logo?v=${encodeURIComponent(r.logo_updated_at ?? "")}` : null,
  colors: parseColors(r.colors),
  website: r.website,
  archived: !!r.archived_at
});

/**
 * The workspaces of some companies, the default one first, then by name. Archived ones only when asked.
 * With forUser, a company where the person is a member lists only the workspaces they are in.
 */
export async function listWorkspaces(
  env: Env,
  companyIds: readonly string[],
  opts: { archived?: boolean; forUser?: { userId: string; roles: ReadonlyMap<string, CompanyRole> } } = {}
): Promise<Map<string, Workspace[]>> {
  const out = new Map<string, Workspace[]>(companyIds.map((id) => [id, []]));
  if (!companyIds.length) return out;
  const rows = await env.DB.prepare(
    `SELECT ${COLUMNS} FROM workspaces WHERE company_id IN (${companyIds.map(() => "?").join(", ")})
     ${opts.archived ? "" : "AND archived_at IS NULL"}
     ORDER BY is_default DESC, name COLLATE NOCASE`
  )
    .bind(...companyIds)
    .all<WorkspaceRow>();
  let mine: Set<string> | null = null;
  if (opts.forUser) {
    const asMember = companyIds.filter((id) => opts.forUser!.roles.get(id) === "member");
    if (asMember.length) {
      const m = await env.DB.prepare(
        `SELECT workspace_id FROM workspace_members WHERE user_id = ? AND company_id IN (${asMember.map(() => "?").join(", ")})`
      )
        .bind(opts.forUser.userId, ...asMember)
        .all<{ workspace_id: string }>();
      mine = new Set(m.results.map((r) => r.workspace_id));
    }
  }
  for (const r of rows.results) {
    if (mine && opts.forUser!.roles.get(r.company_id) === "member" && !mine.has(r.id)) continue;
    out.get(r.company_id)?.push(toWorkspace(r));
  }
  return out;
}

/** The active workspaces a person works in, the default one first. Only a company member has these. */
export async function memberWorkspaceIds(env: Env, companyId: string, userId: string): Promise<string[]> {
  const r = await env.DB.prepare(
    `SELECT w.id FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
     WHERE wm.company_id = ? AND wm.user_id = ? AND w.archived_at IS NULL
     ORDER BY w.is_default DESC, w.name COLLATE NOCASE`
  )
    .bind(companyId, userId)
    .all<{ id: string }>();
  return r.results.map((x) => x.id);
}

/** Puts a person in a workspace. Does nothing when they are in it already. */
export function addWorkspaceMember(env: Env, companyId: string, workspaceId: string, userId: string) {
  return env.DB.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, company_id, user_id, created_at) VALUES (?, ?, ?, ?)").bind(
    workspaceId,
    companyId,
    userId,
    nowIso()
  );
}

/** One workspace of a company, archived or not, or null. */
export async function getWorkspace(env: Env, companyId: string, workspaceId: string): Promise<Workspace | null> {
  const r = await env.DB.prepare(`SELECT ${COLUMNS} FROM workspaces WHERE id = ? AND company_id = ?`).bind(workspaceId, companyId).first<WorkspaceRow>();
  return r ? toWorkspace(r) : null;
}

/** The id of the company's default workspace. */
export async function defaultWorkspaceId(env: Env, companyId: string): Promise<string> {
  const r = await env.DB.prepare("SELECT id FROM workspaces WHERE company_id = ? AND is_default = 1").bind(companyId).first<{ id: string }>();
  if (!r) throw new HttpError(404, "This company has no default workspace. Run the database migrations, then try again.");
  return r.id;
}

/**
 * The workspace to show, as a workspace id, or null for every workspace.
 * `wanted` is what the request asks for: a workspace id, "all", or undefined for the person's saved choice.
 * - Guests always get null: they see what they are invited to, in every workspace.
 * - "all" is for owners and admins. Others get their saved workspace instead.
 * - An archived workspace opens only for owners and admins, and only when asked by id.
 * - A saved choice that is gone, archived or in another company gives the default workspace.
 */
export async function resolveWorkspace(
  env: Env,
  opts: { companyId: string; userId: string; role: CompanyRole | null; wanted?: string | null }
): Promise<string | null> {
  if (!opts.role || opts.role === "guest") return null;
  const manager = isManager(opts.role);
  const wanted = opts.wanted?.trim();
  if (!manager) {
    // A member works only in the workspaces they are in. Another one looks like one that does not exist.
    const mine = await memberWorkspaceIds(env, opts.companyId, opts.userId);
    if (wanted && wanted !== ALL_WORKSPACES) {
      if (!mine.includes(wanted)) throw new HttpError(404, "This workspace does not exist, or you are not in it. Pick another workspace.");
      return wanted;
    }
    const saved = await env.DB.prepare("SELECT current_workspace_id FROM users WHERE id = ?").bind(opts.userId).first<{ current_workspace_id: string | null }>();
    if (saved?.current_workspace_id && mine.includes(saved.current_workspace_id)) return saved.current_workspace_id;
    if (!mine[0]) throw new HttpError(403, "You are not in any workspace of this company. Ask an owner or admin to add you.");
    return mine[0];
  }
  if (wanted === ALL_WORKSPACES && manager) return null;
  if (wanted && wanted !== ALL_WORKSPACES) {
    const ws = await getWorkspace(env, opts.companyId, wanted);
    if (!ws || (ws.archived && !manager)) throw new HttpError(404, "This workspace does not exist, or it was archived. Pick another workspace.");
    return ws.id;
  }
  const saved = await env.DB.prepare("SELECT current_workspace_id FROM users WHERE id = ?").bind(opts.userId).first<{ current_workspace_id: string | null }>();
  const id = saved?.current_workspace_id;
  if (id === ALL_WORKSPACES && manager) return null;
  if (id && id !== ALL_WORKSPACES) {
    const ws = await getWorkspace(env, opts.companyId, id);
    if (ws && !ws.archived) return ws.id;
  }
  return defaultWorkspaceId(env, opts.companyId);
}

/** Checks that a workspace is an active workspace of the company, for moving a row into it. Returns its id. */
export async function requireActiveWorkspace(
  env: Env,
  companyId: string,
  workspaceId: unknown,
  /** When the person is a member, the workspace must be one they are in. */
  who?: { userId: string; role: CompanyRole | null }
): Promise<string> {
  if (typeof workspaceId !== "string" || !workspaceId) throw new HttpError(400, "Pick a workspace.");
  const ws = await getWorkspace(env, companyId, workspaceId);
  if (!ws || ws.archived) throw new HttpError(400, "This workspace does not exist, or it was archived. Pick another workspace.");
  if (who && who.role === "member" && !(await memberWorkspaceIds(env, companyId, who.userId)).includes(ws.id))
    throw new HttpError(400, "This workspace does not exist, or you are not in it. Pick another workspace.");
  return ws.id;
}

/* Changes. Owners and admins only: the routes check the role. */

function readColors(v: unknown): string {
  if (v === null || v === undefined) return "{}";
  if (typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, 'Colors must be an object, such as {"primary": "#1f2937"}.');
  const out: WorkspaceColors = {};
  for (const key of ["primary", "accent"] as const) {
    const c = (v as Record<string, unknown>)[key];
    if (c === undefined || c === null || c === "") continue;
    if (typeof c !== "string" || !isHexColor(c)) throw new HttpError(400, `The ${key} color must be a hex color, such as #1f2937.`);
    out[key] = c.toLowerCase();
  }
  return JSON.stringify(out);
}

function readWebsite(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = text(v, "Website", { max: 253 });
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw new HttpError(400, "Type a website address, such as https://example.com.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, "The website must start with https://.");
  return url.origin;
}

/** A slug that no other workspace of the company uses. */
async function freeSlug(env: Env, companyId: string, base: string, exceptId?: string): Promise<string> {
  const rows = await env.DB.prepare("SELECT slug FROM workspaces WHERE company_id = ? AND id != ?").bind(companyId, exceptId ?? "").all<{ slug: string }>();
  const taken = new Set(rows.results.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now()}`;
}

export interface WorkspaceInput {
  name?: unknown;
  kind?: unknown;
  slug?: unknown;
  website?: unknown;
  colors?: unknown;
  archived?: unknown;
}

/** Makes a workspace. Returns it. */
export async function createWorkspace(env: Env, companyId: string, userId: string, input: WorkspaceInput): Promise<Workspace> {
  const name = text(input.name, "Workspace name", { max: 80, required: true });
  const kind = input.kind === undefined ? "brand" : oneOf(input.kind, "Kind", WORKSPACE_KINDS);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM workspaces WHERE company_id = ?").bind(companyId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_WORKSPACES_PER_COMPANY)
    throw new HttpError(400, `This company has ${MAX_WORKSPACES_PER_COMPANY} workspaces, which is the limit. Archived workspaces count too.`);
  const slug = await freeSlug(env, companyId, input.slug === undefined ? workspaceSlug(name) : slugValue(input.slug));
  const id = newId();
  const iso = nowIso();
  await env.DB.prepare(
    `INSERT INTO workspaces (id, company_id, name, slug, kind, is_default, colors, website, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
  )
    .bind(id, companyId, name, slug, kind, readColors(input.colors), readWebsite(input.website), userId, iso, iso)
    .run();
  return (await getWorkspace(env, companyId, id))!;
}

function slugValue(v: unknown): string {
  const s = text(v, "Slug", { max: 40, required: true }).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) throw new HttpError(400, "A slug uses lowercase letters, numbers and single dashes, such as acme-west.");
  return s;
}

/** Changes a workspace: name, kind, slug, website, colors, or archived. Returns it. */
export async function updateWorkspace(env: Env, companyId: string, workspaceId: string, input: WorkspaceInput): Promise<Workspace> {
  const ws = await getWorkspace(env, companyId, workspaceId);
  if (!ws) throw new HttpError(404, "This workspace does not exist. It may have been removed.");
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (input.name !== undefined) {
    sets.push("name = ?");
    vals.push(text(input.name, "Workspace name", { max: 80, required: true }));
  }
  if (input.kind !== undefined) {
    sets.push("kind = ?");
    vals.push(oneOf(input.kind, "Kind", WORKSPACE_KINDS));
  }
  if (input.slug !== undefined) {
    const slug = slugValue(input.slug);
    if ((await freeSlug(env, companyId, slug, workspaceId)) !== slug) throw new HttpError(409, `Another workspace in this company uses the slug "${slug}".`);
    sets.push("slug = ?");
    vals.push(slug);
  }
  if (input.website !== undefined) {
    sets.push("website = ?");
    vals.push(readWebsite(input.website));
  }
  if (input.colors !== undefined) {
    sets.push("colors = ?");
    vals.push(readColors(input.colors));
  }
  if (input.archived !== undefined) {
    if (typeof input.archived !== "boolean") throw new HttpError(400, "Archived must be true or false.");
    if (input.archived && ws.isDefault) throw new HttpError(400, "The default workspace cannot be archived. It holds work that has no other workspace.");
    // Archiving twice keeps the first archive time.
    if (input.archived !== ws.archived) {
      sets.push("archived_at = ?");
      vals.push(input.archived ? nowIso() : null);
    } else if (!sets.length && Object.keys(input).length === 1) return ws;
  }
  if (!sets.length) throw new HttpError(400, "Nothing to change.");
  sets.push("updated_at = ?");
  vals.push(nowIso());
  await env.DB.prepare(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = ? AND company_id = ?`)
    .bind(...vals, workspaceId, companyId)
    .run();
  return (await getWorkspace(env, companyId, workspaceId))!;
}

