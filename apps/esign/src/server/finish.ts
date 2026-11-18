import { appName, authSecret, newId, nowIso, openSecret, type Env } from "@openact/core/server";
import { SIGN_PATH, ESIGN_HOME, type EventKind } from "../shared/types.ts";
import { buildSignedPdf, pngBytes } from "./pdf.ts";
import {
  TOKEN_PURPOSE,
  bumpState,
  docsLibrary,
  eventStmt,
  fieldsOf,
  loadSettings,
  loadSubmission,
  loadSubmitters,
  valuesOf,
  type SubmissionRow,
  type SubmitterRow
} from "./data.ts";
import { send, senderDoneEmail, signedCopyEmail } from "./emails.ts";

/*
 * Finishing a document: after the last signer signs, the Worker builds the signed PDF with the
 * signing certificate, stores it, saves a copy to Docs when that is on, and emails everyone.
 * It runs after the response. If it fails, the job every 10 minutes tries again, up to 5 times.
 */

export const MAX_FINISH_TRIES = 5;

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The signing link of a signer, from the sealed token. */
export async function signLink(env: Env, s: SubmissionRow, signer: SubmitterRow): Promise<string | null> {
  const token = await openSecret(authSecret(env, s.origin || "http://localhost"), TOKEN_PURPOSE, signer.id, signer.token_box);
  return token ? `${s.origin}${SIGN_PATH}#${token}` : null;
}

async function senderOf(env: Env, userId: string | null): Promise<{ name: string; email: string } | null> {
  if (!userId) return null;
  const u = await env.DB.prepare("SELECT name, email FROM users WHERE id = ?").bind(userId).first<{ name: string | null; email: string }>();
  return u ? { name: u.name?.trim() || u.email.split("@")[0]!, email: u.email } : null;
}

/**
 * Builds and stores the signed PDF when every signer has signed. Safe to run twice:
 * only one run can move the document to completed, and the other run deletes its own file.
 */
export async function finishSubmission(env: Env, submissionId: string, defer: (p: Promise<unknown>) => void): Promise<"done" | "not-ready" | "failed"> {
  const s = await loadSubmission(env, submissionId);
  if (s.status !== "pending" || s.signed_key) return "not-ready";
  const signers = await loadSubmitters(env, s.id);
  if (!signers.length || signers.some((x) => x.status !== "completed")) return "not-ready";

  const key = `esign/${s.company_id}/s/${s.id}/${newId()}.pdf`;
  try {
    const original = await env.FILES.get(s.file_key);
    if (!original) throw new Error("The original PDF is missing from storage.");
    const completedAt = signers.reduce((max, x) => (x.completed_at && x.completed_at > max ? x.completed_at : max), s.created_at);
    const sender = await senderOf(env, s.created_by);
    const byId = new Map(signers.map((x) => [x.id, x.name]));
    const rows = await env.DB.prepare("SELECT kind, detail, ip, submitter_id, at FROM esign_events WHERE submission_id = ? ORDER BY at, rowid")
      .bind(s.id)
      .all<{ kind: EventKind; detail: string; ip: string | null; submitter_id: string | null; at: string }>();
    const events = [
      ...rows.results.map((e) => ({ at: e.at, kind: e.kind, detail: e.detail, ip: e.ip, signer: e.submitter_id ? (byId.get(e.submitter_id) ?? null) : null })),
      { at: completedAt, kind: "completed" as const, detail: "", ip: null, signer: null }
    ];
    const bytes = await buildSignedPdf(new Uint8Array(await original.arrayBuffer()), {
      title: s.name,
      appName: appName(env),
      documentId: s.id,
      sender,
      fileName: s.file_name,
      fileHash: s.file_hash,
      completedAt,
      fields: fieldsOf(s),
      signers: signers.map((x) => ({
        roleId: x.role_id,
        roleName: x.role_name,
        name: x.name,
        email: x.email,
        values: valuesOf(x),
        signature: pngBytes(x.signature),
        initials: pngBytes(x.initials),
        sentAt: x.sent_at,
        openedAt: x.opened_at,
        consentedAt: x.consented_at,
        completedAt: x.completed_at,
        ip: x.ip,
        userAgent: x.user_agent
      })),
      events
    });
    const hash = await sha256Bytes(bytes);
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { sha256: hash } });
    const iso = nowIso();
    const res = await env.DB.batch([
      env.DB.prepare(
        `UPDATE esign_submissions SET status = 'completed', signed_key = ?, signed_size = ?, signed_hash = ?, completed_at = ?, updated_at = ?, rev = rev + 1
         WHERE id = ? AND status = 'pending' AND signed_key IS NULL`
      ).bind(key, bytes.length, hash, completedAt, iso, s.id),
      bumpState(env, s.company_id)
    ]);
    if (!res[0]?.meta.changes) {
      // Another run finished first, or someone voided the document.
      await env.FILES.delete(key);
      return "not-ready";
    }
    await env.DB.batch([eventStmt(env, { submissionId: s.id, companyId: s.company_id, kind: "completed", at: completedAt })]);

    // A copy in Docs, when Docs is on and the company wants it. A failure here does not undo the signing.
    const settings = await loadSettings(env, s.company_id);
    const lib = settings.saveToDocs ? await docsLibrary(env, s.company_id) : null;
    if (lib) {
      try {
        const doc = await lib.savePdf(env, {
          companyId: s.company_id,
          userId: s.created_by,
          title: `${s.name} (signed)`,
          name: s.file_name.replace(/\.pdf$/i, "") + " (signed).pdf",
          bytes,
          folderId: settings.docsFolderId
        });
        await env.DB.prepare("UPDATE esign_submissions SET docs_doc_id = ? WHERE id = ?").bind(doc.id, s.id).run();
      } catch (e) {
        console.warn("[openact] eSign could not save to Docs", e instanceof Error ? e.message : "unknown");
      }
    }

    for (const x of signers) {
      const url = await signLink(env, s, x);
      if (url) send(env, signedCopyEmail(env, { to: x.email, document: s.name, url }), defer);
    }
    if (sender) send(env, senderDoneEmail(env, { to: sender.email, document: s.name, hash, url: `${s.origin}${ESIGN_HOME}/s/${s.id}` }), defer);
    return "done";
  } catch (e) {
    console.error("[openact] eSign could not finish a document", e instanceof Error ? e.message : "unknown");
    await env.FILES.delete(key).catch(() => {});
    await env.DB.prepare("UPDATE esign_submissions SET finish_tries = finish_tries + 1 WHERE id = ?").bind(s.id).run();
    return "failed";
  }
}

/** The job every 10 minutes: finishes documents whose last signature did not finish them. */
export async function finishStuck(env: Env): Promise<void> {
  const before = new Date(Date.now() - 2 * 60_000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT s.id FROM esign_submissions s
     WHERE s.status = 'pending' AND s.signed_key IS NULL AND s.finish_tries < ? AND s.updated_at < ?
       AND NOT EXISTS (SELECT 1 FROM esign_submitters m WHERE m.submission_id = s.id AND m.status != 'completed')
     LIMIT 10`
  )
    .bind(MAX_FINISH_TRIES, before)
    .all<{ id: string }>();
  const waits: Promise<unknown>[] = [];
  for (const r of rows.results) await finishSubmission(env, r.id, (p) => waits.push(p));
  await Promise.allSettled(waits);
}
