import { Hono } from "hono";
import {
  HttpError,
  acceptLive,
  appName,
  appUrl,
  authSecret,
  hasPermission,
  newId,
  nowIso,
  randomToken,
  readJson,
  requirePermission,
  requireUser,
  sealSecret,
  sha256Hex,
  type AppEnv,
  type Env
} from "@openact/core/server";
import {
  ESIGN_HOME,
  LIMITS,
  PDF_MAX_LABEL,
  SIGN_PATH,
  checkFields,
  checkRoles,
  checkSigners,
  cleanLine,
  cleanText,
  sendProblems,
  shortId,
  signersOpen,
  type EsignHome,
  type Submission,
  type SubmissionSummary,
  type Template,
  type TemplateSummary
} from "../shared/types.ts";
import { PdfProblem, inspectPdf, sniffPdf } from "./pdf.ts";
import {
  ROOM,
  SUBMISSION_COLUMNS,
  TEMPLATE_COLUMNS,
  TOKEN_PURPOSE,
  bumpState,
  docsFor,
  eventStmt,
  fieldsOf,
  loadSubmission,
  loadSubmitters,
  loadTemplate,
  names,
  pagesOf,
  rolesOf,
  submissionAccess,
  templateAccess,
  type SubmissionRow,
  type SubmitterRow,
  type TemplateRow
} from "./data.ts";
import { MAX_FINISH_TRIES, finishSubmission, sha256Bytes, signLink } from "./finish.ts";
import { inviteEmail, send, voidedEmail } from "./emails.ts";

/*
 * The signed-in eSign API, under /api/apps/esign.
 *
 *   esign.send    make templates, send documents, and see the documents you sent
 *   esign.manage  see, remind and void every document, and change every template
 *
 * Templates belong to the company: everyone with esign.send can use them.
 * A document belongs to the person who sent it, and to the people who manage eSign.
 */

export const routes = new Hono<AppEnv>();

const defer = (c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }) => (p: Promise<unknown>) => c.executionCtx.waitUntil(p);

/** A PDF response. pdf.js reads it with fetch, so no page needs to frame it. */
export async function pdfResponse(env: Env, key: string, name: string, download: boolean): Promise<Response> {
  const obj = await env.FILES.get(key);
  if (!obj) throw new HttpError(404, "The PDF is missing from storage.");
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(obj.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "Cache-Control": "private, no-store"
    }
  });
}

/** A safe PDF file name: no folders, no control characters, and it ends in .pdf. */
export function cleanFileName(raw: unknown): string {
  let name = typeof raw === "string" ? raw : "";
  name = name
    .replace(/^.*[\\/]/, "")
    .replace(/[\u0000-\u001f\u007f"<>|*?:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/\.pdf$/i.test(name)) name = `${name || "document"}.pdf`;
  if (name.length > LIMITS.name) name = `${name.slice(0, LIMITS.name - 4).trim()}.pdf`;
  return name;
}

const titleOf = (fileName: string) =>
  fileName
    .replace(/\.pdf$/i, "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.name) || "Untitled";

/* Home and live updates */

routes.get("/companies/:companyId/home", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("companyId");
  await requirePermission(c.env, companyId, user.id, "esign.send");
  const manage = await hasPermission(c.env, companyId, user.id, "esign.manage");
  const [docs, counts] = await Promise.all([
    docsFor(c.env, companyId, user.id, "docs.view"),
    c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM esign_submissions WHERE company_id = ?1 AND status = 'pending' AND (?2 OR created_by = ?3)) AS pending,
         (SELECT COUNT(*) FROM esign_submissions WHERE company_id = ?1 AND status = 'completed' AND (?2 OR created_by = ?3)) AS completed,
         (SELECT COUNT(*) FROM esign_templates WHERE company_id = ?1 AND archived_at IS NULL) AS templates`
    )
      .bind(companyId, manage ? 1 : 0, user.id)
      .first<{ pending: number; completed: number; templates: number }>()
  ]);
  return c.json({
    can: { send: true, manage },
    docs: { on: !!docs, canRead: !!docs },
    counts: counts ?? { pending: 0, completed: 0, templates: 0 }
  } satisfies EsignHome);
});

routes.get("/companies/:companyId/live", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("companyId");
  await requirePermission(c.env, companyId, user.id, "esign.send");
  const row = await c.env.DB.prepare("SELECT rev FROM esign_state WHERE company_id = ?").bind(companyId).first<{ rev: number }>();
  return acceptLive(c, ROOM, companyId, { userId: user.id, name: user.name || user.email.split("@")[0]! }, row?.rev ?? 0);
});

/* Templates */

function summary(t: TemplateRow, sent: number, by: Map<string, string>): TemplateSummary {
  return {
    id: t.id,
    name: t.name,
    fileName: t.file_name,
    pageCount: pagesOf(t).length,
    roles: rolesOf(t),
    fieldCount: fieldsOf(t).length,
    sentCount: sent,
    fromDocs: !!t.source_doc,
    createdBy: t.created_by ? (by.get(t.created_by) ?? null) : null,
    updatedAt: t.updated_at
  };
}

routes.get("/companies/:companyId/templates", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("companyId");
  await requirePermission(c.env, companyId, user.id, "esign.send");
  const archived = c.req.query("archived") === "1";
  const rows = await c.env.DB.prepare(
    `SELECT ${TEMPLATE_COLUMNS.split(", ")
      .map((k) => `t.${k}`)
      .join(", ")},
       (SELECT COUNT(*) FROM esign_submissions s WHERE s.template_id = t.id) AS sent
     FROM esign_templates t WHERE t.company_id = ? AND t.archived_at IS ${archived ? "NOT NULL" : "NULL"}
     ORDER BY t.updated_at DESC LIMIT 500`
  )
    .bind(companyId)
    .all<TemplateRow & { sent: number }>();
  const by = await names(
    c.env,
    rows.results.map((r) => r.created_by)
  );
  return c.json({ templates: rows.results.map((r) => summary(r, r.sent, by)) });
});

async function createTemplate(
  env: Env,
  p: { companyId: string; userId: string; name: string; fileName: string; bytes: Uint8Array; sourceDoc: string | null }
): Promise<string> {
  if (p.bytes.length > LIMITS.pdfBytes) throw new HttpError(413, `The PDF is too large. The limit is ${PDF_MAX_LABEL}.`);
  let pages;
  try {
    pages = await inspectPdf(p.bytes, LIMITS.pages);
  } catch (e) {
    if (e instanceof PdfProblem) throw new HttpError(400, e.message, "pdf");
    throw e;
  }
  const id = newId();
  const key = `esign/${p.companyId}/t/${id}.pdf`;
  const iso = nowIso();
  const hash = await sha256Bytes(p.bytes);
  await env.FILES.put(key, p.bytes, { httpMetadata: { contentType: "application/pdf" } });
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO esign_templates (id, company_id, name, file_key, file_name, file_size, file_hash, pages, roles, fields, source_doc, rev, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 1, ?, ?, ?, ?)`
      ).bind(
        id,
        p.companyId,
        p.name,
        key,
        p.fileName,
        p.bytes.length,
        hash,
        JSON.stringify(pages),
        JSON.stringify([{ id: shortId(), name: "Signer" }]),
        p.sourceDoc,
        p.userId,
        p.userId,
        iso,
        iso
      ),
      bumpState(env, p.companyId)
    ]);
  } catch (e) {
    await env.FILES.delete(key);
    throw e;
  }
  return id;
}

/** Makes a template from an uploaded PDF. Form fields: file, and name?. */
routes.post("/companies/:companyId/templates", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("companyId");
  await requirePermission(c.env, companyId, user.id, "esign.send");
  const length = Number(c.req.header("content-length") || 0);
  if (length > LIMITS.pdfBytes + 1024 * 1024) throw new HttpError(413, `The PDF is too large. The limit is ${PDF_MAX_LABEL}.`);
  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody();
  } catch {
    throw new HttpError(400, "Send the PDF as a form upload, in a field named file.");
  }
  const file = form.file;
  if (!(file instanceof File)) throw new HttpError(400, "Choose a PDF to upload.");
  if (file.size === 0) throw new HttpError(400, "The PDF is empty. Choose another file.");
  if (file.size > LIMITS.pdfBytes) throw new HttpError(413, `The PDF is too large. The limit is ${PDF_MAX_LABEL}.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffPdf(bytes)) throw new HttpError(400, "This file is not a PDF. Choose a PDF file.", "not_pdf");
  const fileName = cleanFileName(file.name);
  const name = cleanLine(form.name, LIMITS.name) || titleOf(fileName);
  const id = await createTemplate(c.env, { companyId, userId: user.id, name, fileName, bytes, sourceDoc: null });
  return c.json({ id }, 201);
});

/** PDFs in the Docs library, to make a template from. Needs Docs on and docs.view. */
routes.get("/companies/:companyId/docs-pdfs", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("companyId");
  await requirePermission(c.env, companyId, user.id, "esign.send");
  const lib = await docsFor(c.env, companyId, user.id, "docs.view");
  if (!lib) throw new HttpError(403, "Docs is off, or you cannot see docs. Upload the PDF instead.");
  return c.json({ pdfs: await lib.listPdfs(c.env, companyId, { query: c.req.query("q") ?? "", limit: 100 }) });
});

/** Makes a template from a PDF in the Docs library. Body: { docId, name? }. */
routes.post("/companies/:companyId/templates/from-docs", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("companyId");
  await requirePermission(c.env, companyId, user.id, "esign.send");
  const lib = await docsFor(c.env, companyId, user.id, "docs.view");
  if (!lib) throw new HttpError(403, "Docs is off, or you cannot see docs. Upload the PDF instead.");
  const body = await readJson(c);
  if (typeof body.docId !== "string") throw new HttpError(400, "Choose a PDF from Docs.");
  const pdf = await lib.readPdf(c.env, companyId, body.docId);
  if (!pdf) throw new HttpError(404, "That PDF is not in Docs anymore. Choose another one.");
  const name = cleanLine(body.name, LIMITS.name) || pdf.title.slice(0, LIMITS.name);
  const id = await createTemplate(c.env, { companyId, userId: user.id, name, fileName: cleanFileName(pdf.name), bytes: pdf.bytes, sourceDoc: body.docId });
  return c.json({ id }, 201);
});

routes.get("/templates/:id", async (c) => {
  const user = requireUser(c);
  const t = await loadTemplate(c.env, c.req.param("id"));
  const { canEdit } = await templateAccess(c.env, t, user.id);
  return c.json({
    id: t.id,
    name: t.name,
    fileName: t.file_name,
    fileSize: t.file_size,
    pages: pagesOf(t),
    roles: rolesOf(t),
    fields: fieldsOf(t),
    rev: t.rev,
    updatedAt: t.updated_at,
    canEdit,
    archived: !!t.archived_at
  } satisfies Template);
});

routes.get("/templates/:id/file", async (c) => {
  const user = requireUser(c);
  const t = await loadTemplate(c.env, c.req.param("id"));
  await templateAccess(c.env, t, user.id);
  return pdfResponse(c.env, t.file_key, t.file_name, c.req.query("download") === "1");
});

/** Saves the name, roles and fields. Body: { rev, name?, roles?, fields? }. A save with an old rev is refused. */
routes.patch("/templates/:id", async (c) => {
  const user = requireUser(c);
  const t = await loadTemplate(c.env, c.req.param("id"));
  await templateAccess(c.env, t, user.id, true);
  const body = await readJson(c);
  if (body.rev !== t.rev) throw new HttpError(409, "Someone else saved this template. Load the page again, then make your change again.", "conflict");
  const name = body.name === undefined ? t.name : cleanLine(body.name, LIMITS.name);
  if (!name) throw new HttpError(400, "The template needs a name.");
  let roles = rolesOf(t);
  if (body.roles !== undefined) {
    const r = checkRoles(body.roles);
    if ("problem" in r) throw new HttpError(400, r.problem);
    roles = r.ok;
  }
  const f = checkFields(body.fields === undefined ? fieldsOf(t) : body.fields, roles, pagesOf(t).length);
  if ("problem" in f) throw new HttpError(400, f.problem);
  const iso = nowIso();
  const res = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE esign_templates SET name = ?, roles = ?, fields = ?, rev = rev + 1, updated_by = ?, updated_at = ? WHERE id = ? AND rev = ?").bind(
      name,
      JSON.stringify(roles),
      JSON.stringify(f.ok),
      user.id,
      iso,
      t.id,
      t.rev
    ),
    bumpState(c.env, t.company_id)
  ]);
  if (!res[0]?.meta.changes) throw new HttpError(409, "Someone else saved this template. Load the page again, then make your change again.", "conflict");
  return c.json({ rev: t.rev + 1, fields: f.ok, roles, name });
});

routes.post("/templates/:id/duplicate", async (c) => {
  const user = requireUser(c);
  const t = await loadTemplate(c.env, c.req.param("id"));
  await templateAccess(c.env, t, user.id);
  const obj = await c.env.FILES.get(t.file_key);
  if (!obj) throw new HttpError(404, "The PDF of this template is missing from storage.");
  const id = newId();
  const key = `esign/${t.company_id}/t/${id}.pdf`;
  const iso = nowIso();
  await c.env.FILES.put(key, await obj.arrayBuffer(), { httpMetadata: { contentType: "application/pdf" } });
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO esign_templates (id, company_id, name, file_key, file_name, file_size, file_hash, pages, roles, fields, source_doc, rev, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
    ).bind(
      id,
      t.company_id,
      `${t.name} (copy)`.slice(0, LIMITS.name),
      key,
      t.file_name,
      t.file_size,
      t.file_hash,
      t.pages,
      t.roles,
      t.fields,
      t.source_doc,
      user.id,
      user.id,
      iso,
      iso
    ),
    bumpState(c.env, t.company_id)
  ]);
  return c.json({ id }, 201);
});

/** Archives or restores a template. Body: { archived }. Documents sent from it keep working. */
routes.post("/templates/:id/archive", async (c) => {
  const user = requireUser(c);
  const t = await loadTemplate(c.env, c.req.param("id"));
  await templateAccess(c.env, t, user.id, true);
  const body = await readJson(c);
  if (typeof body.archived !== "boolean") throw new HttpError(400, "Send archived as true or false.");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE esign_templates SET archived_at = ?, updated_at = ? WHERE id = ?").bind(body.archived ? nowIso() : null, nowIso(), t.id),
    bumpState(c.env, t.company_id)
  ]);
  return c.json({ ok: true });
});

/** Deletes a template that was never sent. A template with documents can only be archived, so the documents keep their PDF. */
routes.delete("/templates/:id", async (c) => {
  const user = requireUser(c);
  const t = await loadTemplate(c.env, c.req.param("id"));
  await templateAccess(c.env, t, user.id, true);
  const used = await c.env.DB.prepare("SELECT 1 AS x FROM esign_submissions WHERE file_key = ? LIMIT 1").bind(t.file_key).first();
  if (used) throw new HttpError(409, "Documents were sent from this template, so it cannot be deleted. Archive it instead.", "in_use");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM esign_templates WHERE id = ?").bind(t.id), bumpState(c.env, t.company_id)]);
  await c.env.FILES.delete(t.file_key);
  return c.json({ ok: true });
});

/* Send */

/** Makes a signer's link token. Returns the token, its hash and the sealed token. */
async function newSignerToken(env: Env, origin: string, signerId: string) {
  const token = randomToken(32);
  const [hash, box] = await Promise.all([sha256Hex(token), sealSecret(authSecret(env, origin), TOKEN_PURPOSE, signerId, token)]);
  return { token, hash, box };
}

async function companyName(env: Env, companyId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(companyId).first<{ name: string }>();
  return row?.name || appName(env);
}

/** Sends a template for signature. Body: { signers: [{ roleId, name, email }], ordered, message, name? }. */
routes.post("/templates/:id/send", async (c) => {
  const user = requireUser(c);
  const t = await loadTemplate(c.env, c.req.param("id"));
  await templateAccess(c.env, t, user.id);
  if (t.archived_at) throw new HttpError(400, "This template is archived. Restore it before you send it.");
  const roles = rolesOf(t);
  const fields = fieldsOf(t);
  const problems = sendProblems(roles, fields);
  if (problems.length) throw new HttpError(400, problems[0]!);
  const body = await readJson(c);
  const signers = checkSigners(body.signers, roles);
  if ("problem" in signers) throw new HttpError(400, signers.problem);
  const ordered = body.ordered === true && roles.length > 1;
  const message = cleanText(body.message, LIMITS.message);
  const name = cleanLine(body.name, LIMITS.name) || t.name;
  const origin = appUrl(c);
  const iso = nowIso();
  const id = newId();
  const ip = c.req.header("cf-connecting-ip") || null;

  const rows = await Promise.all(
    signers.ok.map(async (s, position) => {
      const signerId = newId();
      const role = roles.find((r) => r.id === s.roleId)!;
      return { ...s, id: signerId, position, roleName: role.name, ...(await newSignerToken(c.env, origin, signerId)) };
    })
  );
  const open = new Set(
    signersOpen(
      rows.map((r) => ({ ...r, status: "waiting" as const })),
      ordered,
      "pending"
    ).map((r) => r.id)
  );

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO esign_submissions (id, company_id, template_id, name, file_key, file_name, file_hash, pages, fields, ordered, message, origin, status, rev, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?)`
    ).bind(id, t.company_id, t.id, name, t.file_key, t.file_name, t.file_hash, t.pages, t.fields, ordered ? 1 : 0, message, origin, user.id, iso, iso),
    ...rows.map((r) =>
      c.env.DB.prepare(
        `INSERT INTO esign_submitters (id, submission_id, company_id, role_id, role_name, position, name, email, token_hash, token_box, status, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        r.id,
        id,
        t.company_id,
        r.roleId,
        r.roleName,
        r.position,
        r.name,
        r.email,
        r.hash,
        r.box,
        open.has(r.id) ? "sent" : "waiting",
        open.has(r.id) ? iso : null
      )
    ),
    eventStmt(c.env, { submissionId: id, companyId: t.company_id, kind: "created", detail: `by ${user.name || user.email}`, ip, at: iso }),
    ...rows
      .filter((r) => open.has(r.id))
      .map((r) => eventStmt(c.env, { submissionId: id, companyId: t.company_id, kind: "sent", submitterId: r.id, detail: r.email, at: iso })),
    bumpState(c.env, t.company_id)
  ]);

  const company = await companyName(c.env, t.company_id);
  const sender = user.name || user.email;
  for (const r of rows.filter((x) => open.has(x.id))) {
    send(c.env, inviteEmail(c.env, { to: r.email, sender, company, document: name, note: message, url: `${origin}${SIGN_PATH}#${r.token}` }), defer(c));
  }
  return c.json({ id }, 201);
});

/* Documents */

function signerSummaries(rows: SubmitterRow[]) {
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    roleName: s.role_name,
    position: s.position,
    status: s.status,
    completedAt: s.completed_at
  }));
}

routes.get("/companies/:companyId/submissions", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("companyId");
  await requirePermission(c.env, companyId, user.id, "esign.send");
  const manage = await hasPermission(c.env, companyId, user.id, "esign.manage");
  const status = c.req.query("status");
  const filter = status && ["pending", "completed", "declined", "voided"].includes(status) ? status : null;
  const onlyMine = !manage || c.req.query("mine") === "1";
  const rows = await c.env.DB.prepare(
    `SELECT ${SUBMISSION_COLUMNS} FROM esign_submissions WHERE company_id = ? ${filter ? "AND status = ?" : ""} ${onlyMine ? "AND created_by = ?" : ""}
     ORDER BY created_at DESC LIMIT 300`
  )
    .bind(...[companyId, ...(filter ? [filter] : []), ...(onlyMine ? [user.id] : [])])
    .all<SubmissionRow>();
  const ids = rows.results.map((r) => r.id);
  const signers = ids.length
    ? (
        await c.env.DB.prepare(
          `SELECT id, submission_id, name, email, role_name, position, status, completed_at FROM esign_submitters WHERE submission_id IN (${ids.map(() => "?").join(", ")}) ORDER BY position`
        )
          .bind(...ids)
          .all<SubmitterRow>()
      ).results
    : [];
  const by = await names(
    c.env,
    rows.results.map((r) => r.created_by)
  );
  const list: SubmissionSummary[] = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    ordered: r.ordered === 1,
    signers: signerSummaries(signers.filter((s) => s.submission_id === r.id)),
    createdBy: r.created_by ? (by.get(r.created_by) ?? null) : null,
    createdAt: r.created_at,
    completedAt: r.completed_at
  }));
  return c.json({ submissions: list, manage });
});

routes.get("/submissions/:id", async (c) => {
  const user = requireUser(c);
  const s = await loadSubmission(c.env, c.req.param("id"));
  const { canManage } = await submissionAccess(c.env, s, user.id);
  const [signers, events, by] = await Promise.all([
    loadSubmitters(c.env, s.id),
    c.env.DB.prepare("SELECT kind, detail, ip, submitter_id, at FROM esign_events WHERE submission_id = ? ORDER BY at, rowid")
      .bind(s.id)
      .all<{ kind: Submission["events"][number]["kind"]; detail: string; ip: string | null; submitter_id: string | null; at: string }>(),
    names(c.env, [s.created_by])
  ]);
  const nameOf = new Map(signers.map((x) => [x.id, x.name]));
  const docs = s.docs_doc_id ? await docsFor(c.env, s.company_id, user.id, "docs.view") : null;
  return c.json({
    id: s.id,
    name: s.name,
    status: s.status,
    ordered: s.ordered === 1,
    signers: signerSummaries(signers),
    signersDetail: signers.map((x) => ({
      ...signerSummaries([x])[0]!,
      sentAt: x.sent_at,
      openedAt: x.opened_at,
      declineReason: x.decline_reason,
      remindedAt: x.reminded_at
    })),
    createdBy: s.created_by ? (by.get(s.created_by) ?? null) : null,
    createdAt: s.created_at,
    completedAt: s.completed_at,
    templateId: s.template_id,
    message: s.message,
    fileName: s.file_name,
    fileHash: s.file_hash,
    signed: s.signed_key && s.signed_hash ? { size: s.signed_size ?? 0, hash: s.signed_hash } : null,
    finishing: s.status === "pending" && signers.length > 0 && signers.every((x) => x.status === "completed"),
    docsPath: docs && s.docs_doc_id ? `/a/docs/p/${s.docs_doc_id}` : null,
    events: events.results.map((e) => ({
      kind: e.kind,
      detail: e.detail,
      ip: e.ip,
      at: e.at,
      signer: e.submitter_id ? (nameOf.get(e.submitter_id) ?? null) : null
    })),
    canManage
  } satisfies Submission);
});

routes.get("/submissions/:id/file", async (c) => {
  const user = requireUser(c);
  const s = await loadSubmission(c.env, c.req.param("id"));
  await submissionAccess(c.env, s, user.id);
  return pdfResponse(c.env, s.file_key, s.file_name, c.req.query("download") === "1");
});

routes.get("/submissions/:id/signed", async (c) => {
  const user = requireUser(c);
  const s = await loadSubmission(c.env, c.req.param("id"));
  await submissionAccess(c.env, s, user.id);
  if (!s.signed_key) throw new HttpError(404, "The signed PDF is not ready yet. Everyone must sign first.");
  return pdfResponse(c.env, s.signed_key, s.file_name.replace(/\.pdf$/i, "") + " (signed).pdf", c.req.query("download") !== "0");
});

const REMIND_GAP_MS = 60 * 60 * 1000;

/** Emails the signers who can sign now and have not signed, with the same link. At most once an hour per signer. */
routes.post("/submissions/:id/remind", async (c) => {
  const user = requireUser(c);
  const s = await loadSubmission(c.env, c.req.param("id"));
  await submissionAccess(c.env, s, user.id);
  if (s.status !== "pending") throw new HttpError(400, "This document is closed. Only open documents get reminders.");
  const signers = await loadSubmitters(c.env, s.id);
  const now = Date.now();
  const due = signersOpen(signers, s.ordered === 1, s.status).filter((x) => !x.reminded_at || now - Date.parse(x.reminded_at) >= REMIND_GAP_MS);
  if (!due.length) throw new HttpError(429, "Everyone who can sign now got a reminder in the last hour. Try again later.", "too_soon");
  const iso = nowIso();
  await c.env.DB.batch([
    ...due.map((x) => c.env.DB.prepare("UPDATE esign_submitters SET reminded_at = ? WHERE id = ?").bind(iso, x.id)),
    ...due.map((x) => eventStmt(c.env, { submissionId: s.id, companyId: s.company_id, kind: "reminded", submitterId: x.id, detail: x.email, at: iso })),
    bumpState(c.env, s.company_id)
  ]);
  const company = await companyName(c.env, s.company_id);
  for (const x of due) {
    const url = await signLink(c.env, s, x);
    if (url)
      send(
        c.env,
        inviteEmail(c.env, { to: x.email, sender: user.name || user.email, company, document: s.name, note: s.message, url, reminder: true }),
        defer(c)
      );
  }
  return c.json({ reminded: due.length });
});

/** Cancels an open document. The signing links stop working. Body: { reason? }. */
routes.post("/submissions/:id/void", async (c) => {
  const user = requireUser(c);
  const s = await loadSubmission(c.env, c.req.param("id"));
  await submissionAccess(c.env, s, user.id);
  if (s.status !== "pending") throw new HttpError(400, "Only a document that is waiting for signatures can be voided.");
  const body = await readJson(c);
  const reason = cleanLine(body.reason, 300);
  const iso = nowIso();
  const res = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE esign_submissions SET status = 'voided', voided_at = ?, updated_at = ?, rev = rev + 1 WHERE id = ? AND status = 'pending'").bind(
      iso,
      iso,
      s.id
    ),
    eventStmt(c.env, {
      submissionId: s.id,
      companyId: s.company_id,
      kind: "voided",
      detail: reason ? `by ${user.name || user.email}: ${reason}` : `by ${user.name || user.email}`,
      at: iso
    }),
    bumpState(c.env, s.company_id)
  ]);
  if (!res[0]?.meta.changes) throw new HttpError(409, "This document changed at the same moment. Load the page again.", "conflict");
  const signers = await loadSubmitters(c.env, s.id);
  for (const x of signers.filter((x) => x.status === "sent" || x.status === "opened")) {
    send(c.env, voidedEmail(c.env, { to: x.email, sender: user.name || user.email, document: s.name }), defer(c));
  }
  return c.json({ ok: true });
});

/** Tries again to build the signed PDF, after the automatic tries failed. */
routes.post("/submissions/:id/finish", async (c) => {
  const user = requireUser(c);
  const s = await loadSubmission(c.env, c.req.param("id"));
  await submissionAccess(c.env, s, user.id);
  if (s.status !== "pending") throw new HttpError(400, "This document is not waiting to be finished.");
  if (s.finish_tries >= MAX_FINISH_TRIES) await c.env.DB.prepare("UPDATE esign_submissions SET finish_tries = 0 WHERE id = ?").bind(s.id).run();
  const r = await finishSubmission(c.env, s.id, defer(c));
  if (r === "failed") throw new HttpError(500, "The signed PDF could not be made. Try again in a few minutes.");
  if (r === "not-ready") throw new HttpError(400, "Not everyone has signed yet.");
  return c.json({ ok: true });
});

/** Deletes a voided or declined document and its audit log. Completed documents stay as records. */
routes.delete("/submissions/:id", async (c) => {
  const user = requireUser(c);
  const s = await loadSubmission(c.env, c.req.param("id"));
  await submissionAccess(c.env, s, user.id);
  if (s.status === "pending" || s.status === "completed") throw new HttpError(400, "Only a voided or declined document can be deleted. Void it first.");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM esign_events WHERE submission_id = ?").bind(s.id),
    c.env.DB.prepare("DELETE FROM esign_submitters WHERE submission_id = ?").bind(s.id),
    c.env.DB.prepare("DELETE FROM esign_submissions WHERE id = ?").bind(s.id),
    bumpState(c.env, s.company_id)
  ]);
  // The PDF belongs to the template. Delete it only when no template and no other document uses it.
  const used = await c.env.DB.prepare(
    "SELECT 1 AS x FROM esign_templates WHERE file_key = ?1 UNION ALL SELECT 1 FROM esign_submissions WHERE file_key = ?1 LIMIT 1"
  )
    .bind(s.file_key)
    .first();
  if (!used) await c.env.FILES.delete(s.file_key);
  return c.json({ ok: true });
});

/** Docs folders, for the eSign section of Company settings. */
routes.get("/companies/:companyId/docs-folders", async (c) => {
  const user = requireUser(c);
  const companyId = c.req.param("companyId");
  await requirePermission(c.env, companyId, user.id, "esign.manage");
  const lib = await docsFor(c.env, companyId, user.id, "docs.view");
  return c.json({ on: !!lib, folders: lib ? await lib.folders(c.env, companyId) : [] });
});
