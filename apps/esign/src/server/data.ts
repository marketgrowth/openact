import type { Context } from "hono";
import {
  HttpError,
  appService,
  companyAppState,
  hasPermission,
  markChanged,
  newId,
  nowIso,
  requirePermission,
  type AppEnv,
  type Env
} from "@openact/core/server";
import type { EsignSettings, EventKind, Field, FieldValue, PageSize, Role, SignerStatus, SubmissionStatus } from "../shared/types.ts";

/*
 * Rows, access checks and small helpers for the eSign server.
 */

export const ROOM = "esign-company";
export const TOKEN_PURPOSE = "esign-signer";
export type C = Context<AppEnv>;

export interface TemplateRow {
  id: string;
  company_id: string;
  name: string;
  file_key: string;
  file_name: string;
  file_size: number;
  file_hash: string;
  pages: string;
  roles: string;
  fields: string;
  source_doc: string | null;
  archived_at: string | null;
  rev: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubmissionRow {
  id: string;
  company_id: string;
  template_id: string | null;
  name: string;
  file_key: string;
  file_name: string;
  file_hash: string;
  pages: string;
  fields: string;
  ordered: number;
  message: string;
  origin: string;
  status: SubmissionStatus;
  signed_key: string | null;
  signed_size: number | null;
  signed_hash: string | null;
  finish_tries: number;
  docs_doc_id: string | null;
  rev: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  voided_at: string | null;
}

export interface SubmitterRow {
  id: string;
  submission_id: string;
  company_id: string;
  role_id: string;
  role_name: string;
  position: number;
  name: string;
  email: string;
  token_hash: string;
  token_box: string;
  status: SignerStatus;
  field_values: string;
  signature: string | null;
  initials: string | null;
  decline_reason: string | null;
  ip: string | null;
  user_agent: string | null;
  sent_at: string | null;
  opened_at: string | null;
  consented_at: string | null;
  completed_at: string | null;
  declined_at: string | null;
  reminded_at: string | null;
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const pagesOf = (r: { pages: string }) => parseJson<PageSize[]>(r.pages, []);
export const rolesOf = (r: { roles: string }) => parseJson<Role[]>(r.roles, []);
export const fieldsOf = (r: { fields: string }) => parseJson<Field[]>(r.fields, []);
export const valuesOf = (r: { field_values: string }) => parseJson<Record<string, FieldValue>>(r.field_values, {});

/** A statement that raises the company's eSign revision, so open pages load again. */
export function bumpState(env: Env, companyId: string): D1PreparedStatement {
  markChanged(ROOM, companyId);
  return env.DB.prepare("INSERT INTO esign_state (company_id, rev) VALUES (?, 1) ON CONFLICT (company_id) DO UPDATE SET rev = rev + 1").bind(companyId);
}

/** A statement that adds an audit event. */
export function eventStmt(
  env: Env,
  e: {
    submissionId: string;
    companyId: string;
    kind: EventKind;
    submitterId?: string | null;
    detail?: string;
    ip?: string | null;
    userAgent?: string | null;
    at?: string;
  }
): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO esign_events (id, submission_id, company_id, submitter_id, kind, detail, ip, user_agent, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(newId(), e.submissionId, e.companyId, e.submitterId ?? null, e.kind, e.detail ?? "", e.ip ?? null, e.userAgent ?? null, e.at ?? nowIso());
}

export const clientIp = (c: C) => c.req.header("cf-connecting-ip") || c.req.header("x-real-ip") || null;
export const userAgent = (c: C) => (c.req.header("user-agent") || "").slice(0, 300) || null;

/* Templates */

export const TEMPLATE_COLUMNS =
  "id, company_id, name, file_key, file_name, file_size, file_hash, pages, roles, fields, source_doc, archived_at, rev, created_by, created_at, updated_at";

export async function loadTemplate(env: Env, id: string): Promise<TemplateRow> {
  const row = await env.DB.prepare(`SELECT ${TEMPLATE_COLUMNS} FROM esign_templates WHERE id = ?`).bind(id).first<TemplateRow>();
  if (!row) throw new HttpError(404, "This template does not exist. It may have been deleted.");
  return row;
}

/** Checks that the person can use the template. With `edit`, also that they can change it: they made it, or they manage eSign. */
export async function templateAccess(env: Env, t: TemplateRow, userId: string, edit = false): Promise<{ canEdit: boolean }> {
  await requirePermission(env, t.company_id, userId, "esign.send");
  const canEdit = t.created_by === userId || (await hasPermission(env, t.company_id, userId, "esign.manage"));
  if (edit && !canEdit) throw new HttpError(403, "Only the person who made this template, or a company owner or admin, can change it.");
  return { canEdit };
}

/* Documents */

export const SUBMISSION_COLUMNS =
  "id, company_id, template_id, name, file_key, file_name, file_hash, pages, fields, ordered, message, origin, status, signed_key, signed_size, signed_hash, finish_tries, docs_doc_id, rev, created_by, created_at, updated_at, completed_at, voided_at";

export const SUBMITTER_COLUMNS =
  "id, submission_id, company_id, role_id, role_name, position, name, email, token_hash, token_box, status, field_values, signature, initials, decline_reason, ip, user_agent, sent_at, opened_at, consented_at, completed_at, declined_at, reminded_at";

export async function loadSubmission(env: Env, id: string): Promise<SubmissionRow> {
  const row = await env.DB.prepare(`SELECT ${SUBMISSION_COLUMNS} FROM esign_submissions WHERE id = ?`).bind(id).first<SubmissionRow>();
  if (!row) throw new HttpError(404, "This document does not exist. It may have been deleted.");
  return row;
}

export async function loadSubmitters(env: Env, submissionId: string): Promise<SubmitterRow[]> {
  const rows = await env.DB.prepare(`SELECT ${SUBMITTER_COLUMNS} FROM esign_submitters WHERE submission_id = ? ORDER BY position`)
    .bind(submissionId)
    .all<SubmitterRow>();
  return rows.results;
}

/** Checks that the person can see a document: they sent it, or they manage eSign. */
export async function submissionAccess(env: Env, s: SubmissionRow, userId: string): Promise<{ canManage: boolean }> {
  await requirePermission(env, s.company_id, userId, "esign.send");
  const manager = await hasPermission(env, s.company_id, userId, "esign.manage");
  if (s.created_by !== userId && !manager) throw new HttpError(403, "Only the person who sent this document, or a company owner or admin, can see it.");
  return { canManage: true };
}

/* Settings */

export async function loadSettings(env: Env, companyId: string): Promise<EsignSettings> {
  const row = await env.DB.prepare("SELECT save_to_docs, docs_folder_id FROM esign_settings WHERE company_id = ?")
    .bind(companyId)
    .first<{ save_to_docs: number; docs_folder_id: string | null }>();
  return { saveToDocs: row ? row.save_to_docs === 1 : true, docsFolderId: row?.docs_folder_id ?? null };
}

/* The Docs app, when it is installed and on */

/** The Docs library service. Kept in step with apps/docs/src/server/library-service.ts. */
export interface DocsLibraryService {
  listPdfs(
    env: Env,
    companyId: string,
    opts?: { query?: string; limit?: number }
  ): Promise<Array<{ id: string; title: string; name: string; size: number; folder: string | null; updatedAt: string }>>;
  readPdf(env: Env, companyId: string, docId: string): Promise<{ title: string; name: string; bytes: Uint8Array } | null>;
  folders(env: Env, companyId: string): Promise<Array<{ id: string; path: string }>>;
  savePdf(
    env: Env,
    p: { companyId: string; userId: string | null; title: string; name: string; bytes: Uint8Array; folderId: string | null }
  ): Promise<{ id: string; path: string }>;
}

/** The Docs library, when Docs is installed and on for the company. Null otherwise. */
export async function docsLibrary(env: Env, companyId: string): Promise<DocsLibraryService | null> {
  const lib = appService<DocsLibraryService>("docs", "library");
  if (!lib) return null;
  const state = await companyAppState(env, companyId);
  return state.enabled("docs") ? lib : null;
}

/** The Docs library, when the person can also use Docs: docs.view to read, docs.edit to save. */
export async function docsFor(env: Env, companyId: string, userId: string, need: "docs.view" | "docs.edit"): Promise<DocsLibraryService | null> {
  const lib = await docsLibrary(env, companyId);
  if (!lib) return null;
  return (await hasPermission(env, companyId, userId, need)) ? lib : null;
}

/** People's names for ids, for lists. */
export async function names(env: Env, ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const rows = await env.DB.prepare(`SELECT id, name, email FROM users WHERE id IN (${unique.map(() => "?").join(", ")})`)
    .bind(...unique)
    .all<{ id: string; name: string | null; email: string }>();
  return new Map(rows.results.map((r) => [r.id, r.name?.trim() || r.email.split("@")[0]!]));
}
