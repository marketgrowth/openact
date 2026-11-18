import { Hono } from "hono";
import { HttpError, companyAppState, nowIso, readJson, sha256Hex, type AppEnv } from "@openact/core/server";
import { ESIGN_HOME, LIMITS, checkValues, cleanLine, isPngDataUrl, signersOpen, type SignView } from "../shared/types.ts";
import { pngBytes } from "./pdf.ts";
import {
  SUBMISSION_COLUMNS,
  SUBMITTER_COLUMNS,
  bumpState,
  clientIp,
  eventStmt,
  fieldsOf,
  loadSubmitters,
  pagesOf,
  userAgent,
  valuesOf,
  type C,
  type SubmissionRow,
  type SubmitterRow
} from "./data.ts";
import { finishSubmission, signLink } from "./finish.ts";
import { declinedEmail, inviteEmail, send } from "./emails.ts";
import { pdfResponse } from "./routes.ts";

/*
 * The public signing API, under /api/apps/esign/public. A signer needs no account.
 * The signing token comes in the X-Esign-Token header, never in a URL, so it stays out of logs.
 * Only the hash of the token is stored. A link stops working when the document is voided,
 * or while eSign is off or locked for the company.
 */

export const publicRoutes = new Hono<AppEnv>();

const defer = (c: C) => (p: Promise<unknown>) => c.executionCtx.waitUntil(p);

const DEAD = "This signing link does not work. Ask the person who sent it for a new link.";

async function signerFor(c: C): Promise<{ signer: SubmitterRow; doc: SubmissionRow }> {
  const token = c.req.header("x-esign-token") || "";
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new HttpError(404, DEAD, "dead_link");
  const signer = await c.env.DB.prepare(`SELECT ${SUBMITTER_COLUMNS} FROM esign_submitters WHERE token_hash = ?`)
    .bind(await sha256Hex(token))
    .first<SubmitterRow>();
  if (!signer) throw new HttpError(404, DEAD, "dead_link");
  const doc = await c.env.DB.prepare(`SELECT ${SUBMISSION_COLUMNS} FROM esign_submissions WHERE id = ?`).bind(signer.submission_id).first<SubmissionRow>();
  if (!doc) throw new HttpError(404, DEAD, "dead_link");
  // The plan gate and the app switches apply to public links too.
  const state = await companyAppState(c.env, doc.company_id);
  if (!state.enabled("esign")) throw new HttpError(404, "Signing is not available for this document right now. Ask the person who sent it.", "off");
  return { signer, doc };
}

publicRoutes.post("/public/view", async (c) => {
  const { signer, doc } = await signerFor(c);
  const signers = await loadSubmitters(c.env, doc.id);
  const open = signersOpen(signers, doc.ordered === 1, doc.status).some((x) => x.id === signer.id);

  // The first open of the link goes in the audit log.
  if (open && signer.status === "sent") {
    const iso = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE esign_submitters SET status = 'opened', opened_at = ? WHERE id = ? AND status = 'sent'").bind(iso, signer.id),
      eventStmt(c.env, {
        submissionId: doc.id,
        companyId: doc.company_id,
        kind: "opened",
        submitterId: signer.id,
        ip: clientIp(c),
        userAgent: userAgent(c),
        at: iso
      }),
      bumpState(c.env, doc.company_id)
    ]);
    signer.status = "opened";
  }

  const fields = fieldsOf(doc);
  const roleNames = new Map(signers.map((x) => [x.role_id, x.role_name]));
  const [company, sender] = await Promise.all([
    c.env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(doc.company_id).first<{ name: string }>(),
    doc.created_by ? c.env.DB.prepare("SELECT name, email FROM users WHERE id = ?").bind(doc.created_by).first<{ name: string | null; email: string }>() : null
  ]);
  const view: SignView = {
    document: {
      name: doc.name,
      company: company?.name ?? "",
      sender: sender ? sender.name?.trim() || sender.email : null,
      message: doc.message,
      status: doc.status,
      pages: pagesOf(doc)
    },
    signer: { name: signer.name, email: signer.email, roleName: signer.role_name, status: signer.status },
    fields: fields.filter((f) => f.roleId === signer.role_id),
    others: fields
      .filter((f) => f.roleId !== signer.role_id)
      .map((f) => ({ id: f.id, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, type: f.type, roleName: roleNames.get(f.roleId) ?? "" })),
    values: signer.status === "completed" ? valuesOf(signer) : {},
    canSign: open && (signer.status === "sent" || signer.status === "opened"),
    waiting: doc.status === "pending" && signer.status === "waiting",
    signedReady: doc.status === "completed" && !!doc.signed_key
  };
  return c.json(view);
});

publicRoutes.get("/public/file", async (c) => {
  const { doc } = await signerFor(c);
  if (doc.status === "voided") throw new HttpError(410, "This document was canceled.", "voided");
  return pdfResponse(c.env, doc.file_key, doc.file_name, false);
});

publicRoutes.get("/public/signed", async (c) => {
  const { doc } = await signerFor(c);
  if (doc.status !== "completed" || !doc.signed_key) throw new HttpError(404, "The signed PDF is not ready yet. It is ready when everyone has signed.");
  return pdfResponse(c.env, doc.signed_key, doc.file_name.replace(/\.pdf$/i, "") + " (signed).pdf", true);
});

/** Signs. Body: { consent: true, values: { fieldId: value }, signature?: PNG data URL, initials?: PNG data URL }. */
publicRoutes.post("/public/sign", async (c) => {
  const { signer, doc } = await signerFor(c);
  const signers = await loadSubmitters(c.env, doc.id);
  if (doc.status !== "pending") throw new HttpError(400, "This document is closed. It cannot be signed now.", "closed");
  if (signer.status === "completed") throw new HttpError(400, "You already signed this document.", "signed");
  if (!signersOpen(signers, doc.ordered === 1, doc.status).some((x) => x.id === signer.id))
    throw new HttpError(400, "It is not your turn to sign yet. You get an email when it is.", "waiting");

  const length = Number(c.req.header("content-length") || 0);
  if (length > LIMITS.imageChars * 2 + 200_000) throw new HttpError(413, "The signature images are too large. Draw or type them again.");
  const body = await readJson(c);
  if (body.consent !== true) throw new HttpError(400, "Agree to sign electronically before you sign.", "consent");
  const mine = fieldsOf(doc).filter((f) => f.roleId === signer.role_id);
  const needs = { signature: mine.some((f) => f.type === "signature"), initials: mine.some((f) => f.type === "initials") };
  const signature = needs.signature ? body.signature : null;
  const initials = needs.initials ? body.initials : null;
  if (needs.signature && (!isPngDataUrl(signature) || !pngBytes(signature)))
    throw new HttpError(400, "Add your signature. Draw it, type it or upload an image.");
  if (needs.initials && (!isPngDataUrl(initials) || !pngBytes(initials)))
    throw new HttpError(400, "Add your initials. Draw them, type them or upload an image.");

  const iso = nowIso();
  const values = checkValues(mine, body.values, { name: signer.name, email: signer.email }, iso, { signature: needs.signature, initials: needs.initials });
  if ("problem" in values) throw new HttpError(400, values.problem);
  const ip = clientIp(c);
  const ua = userAgent(c);

  // The next signer in order gets the document now.
  const after = signers.map((x) => (x.id === signer.id ? { ...x, status: "completed" as const } : x));
  const next = signersOpen(after, doc.ordered === 1, doc.status).filter((x) => x.status === "waiting");

  // Claim the signature first, so two sends at the same moment cannot both sign.
  const claim = await c.env.DB.prepare(
    `UPDATE esign_submitters SET status = 'completed', field_values = ?, signature = ?, initials = ?, ip = ?, user_agent = ?, consented_at = ?, completed_at = ?
     WHERE id = ? AND status IN ('sent', 'opened')`
  )
    .bind(JSON.stringify(values.ok), (signature as string | null) ?? null, (initials as string | null) ?? null, ip, ua, iso, iso, signer.id)
    .run();
  if (!claim.meta.changes) throw new HttpError(409, "You already signed this document.", "signed");
  await c.env.DB.batch([
    eventStmt(c.env, { submissionId: doc.id, companyId: doc.company_id, kind: "consented", submitterId: signer.id, ip, userAgent: ua, at: iso }),
    eventStmt(c.env, { submissionId: doc.id, companyId: doc.company_id, kind: "signed", submitterId: signer.id, ip, userAgent: ua, at: iso }),
    ...next.map((x) => c.env.DB.prepare("UPDATE esign_submitters SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'waiting'").bind(iso, x.id)),
    ...next.map((x) => eventStmt(c.env, { submissionId: doc.id, companyId: doc.company_id, kind: "sent", submitterId: x.id, detail: x.email, at: iso })),
    c.env.DB.prepare("UPDATE esign_submissions SET updated_at = ?, rev = rev + 1 WHERE id = ?").bind(iso, doc.id),
    bumpState(c.env, doc.company_id)
  ]);

  if (next.length) {
    const sender = doc.created_by
      ? await c.env.DB.prepare("SELECT name, email FROM users WHERE id = ?").bind(doc.created_by).first<{ name: string | null; email: string }>()
      : null;
    const company = await c.env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(doc.company_id).first<{ name: string }>();
    for (const x of next) {
      const url = await signLink(c.env, doc, x);
      if (url)
        send(
          c.env,
          inviteEmail(c.env, {
            to: x.email,
            sender: sender?.name?.trim() || sender?.email || "Someone",
            company: company?.name ?? "",
            document: doc.name,
            note: doc.message,
            url
          }),
          defer(c)
        );
    }
  }
  const done = after.every((x) => x.status === "completed");
  if (done) c.executionCtx.waitUntil(finishSubmission(c.env, doc.id, defer(c)));
  return c.json({ ok: true, done });
});

/** Declines to sign. Body: { reason? }. The document closes for everyone. */
publicRoutes.post("/public/decline", async (c) => {
  const { signer, doc } = await signerFor(c);
  if (doc.status !== "pending") throw new HttpError(400, "This document is closed.", "closed");
  if (signer.status === "completed") throw new HttpError(400, "You already signed this document.", "signed");
  const body = await readJson(c);
  const reason = cleanLine(body.reason, 500);
  const iso = nowIso();
  const ip = clientIp(c);
  const ua = userAgent(c);
  const claim = await c.env.DB.prepare("UPDATE esign_submissions SET status = 'declined', updated_at = ?, rev = rev + 1 WHERE id = ? AND status = 'pending'")
    .bind(iso, doc.id)
    .run();
  if (!claim.meta.changes) throw new HttpError(409, "This document changed at the same moment. Load the page again.", "conflict");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE esign_submitters SET status = 'declined', declined_at = ?, decline_reason = ?, ip = ?, user_agent = ? WHERE id = ?").bind(
      iso,
      reason,
      ip,
      ua,
      signer.id
    ),
    eventStmt(c.env, { submissionId: doc.id, companyId: doc.company_id, kind: "declined", submitterId: signer.id, detail: reason, ip, userAgent: ua, at: iso }),
    bumpState(c.env, doc.company_id)
  ]);
  if (doc.created_by) {
    const sender = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(doc.created_by).first<{ email: string }>();
    if (sender)
      send(
        c.env,
        declinedEmail(c.env, { to: sender.email, signer: signer.name, document: doc.name, reason, url: `${doc.origin}${ESIGN_HOME}/s/${doc.id}` }),
        defer(c)
      );
  }
  return c.json({ ok: true });
});
