import { Hono, type Context } from "hono";
import { HttpError, appUrl, nowIso, oneOf, readJson, requirePermission, requireUser, text, type AppEnv } from "@openact/core/server";
import { ADVISORY_HOME, LIMITS, feeProblem, percentToBps } from "../shared/rules";
import type { ManagePage, ManagedAdvisor } from "../shared/types";
import { advisorById, feePercent, loadEngagements, loadSettings, photoUrl, type AdvisorRow, type AdvisoryEnv } from "./data";
import { decisionEmail, send } from "./emails";

/*
 * Managing the marketplace: review applications, set each advisor's fee, pause or list advisors,
 * and see every engagement. Every route checks "advisory.manage" (company owners and admins by default).
 */

type C = Context<AppEnv>;
const envOf = (c: C) => c.env as AdvisoryEnv;
const defer = (c: C) => (p: Promise<unknown>) => c.executionCtx.waitUntil(p);

async function manager(c: C) {
  const user = requireUser(c);
  const cid = c.req.param("cid")!;
  const env = envOf(c);
  await requirePermission(env, cid, user.id, "advisory.manage");
  return { cid, userId: user.id, env };
}

async function managedAdvisor(c: C) {
  const m = await manager(c);
  const a = await advisorById(m.env, m.cid, c.req.param("aid")!);
  if (!a || a.status === "draft") throw new HttpError(404, "This profile does not exist, or it is not sent for review yet.");
  return { ...m, a };
}

function readFee(v: unknown): number {
  const p = feeProblem(v);
  if (p) throw new HttpError(400, p);
  return percentToBps(v as number);
}

export const manageRoutes = new Hono<AppEnv>();

manageRoutes.get("/companies/:cid/manage", async (c) => {
  const { cid, env } = await manager(c);
  const [settings, rows, counts, engagements] = await Promise.all([
    loadSettings(env, cid),
    env.DB.prepare(
      `SELECT a.*, u.name AS name, u.email AS email FROM advisory_advisors a JOIN users u ON u.id = a.user_id
       WHERE a.company_id = ? AND a.status != 'draft' ORDER BY a.submitted_at DESC`
    )
      .bind(cid)
      .all<AdvisorRow>(),
    env.DB.prepare(
      `SELECT a.id,
         (SELECT COUNT(*) FROM advisory_offers o WHERE o.advisor_id = a.id AND o.status = 'active') AS offers,
         (SELECT COUNT(*) FROM advisory_engagements e WHERE e.advisor_id = a.id) AS engagements
       FROM advisory_advisors a WHERE a.company_id = ?`
    )
      .bind(cid)
      .all<{ id: string; offers: number; engagements: number }>(),
    loadEngagements(env, "e.company_id = ?", [cid])
  ]);
  const byId = new Map(counts.results.map((r) => [r.id, r]));
  const advisors: ManagedAdvisor[] = rows.results.map((a) => ({
    id: a.id,
    userId: a.user_id,
    name: a.name,
    email: a.email,
    headline: a.headline,
    bio: a.bio,
    photoUrl: photoUrl(a),
    status: a.status,
    feePercent: feePercent(a),
    stripeReady: a.stripe_ready === 1,
    offers: byId.get(a.id)?.offers ?? 0,
    engagements: byId.get(a.id)?.engagements ?? 0,
    submittedAt: a.submitted_at
  }));
  const page: ManagePage = { settings, advisors, engagements };
  return c.json(page);
});

manageRoutes.post("/companies/:cid/manage/advisors/:aid/approve", async (c) => {
  const { cid, userId, env, a } = await managedAdvisor(c);
  if (a.status === "approved") throw new HttpError(400, "This profile is already live.");
  const body = await readJson(c);
  const settings = await loadSettings(env, cid);
  const fee = body.feePercent === undefined ? percentToBps(settings.defaultFeePercent) : readFee(body.feePercent);
  const iso = nowIso();
  await env.DB.prepare("UPDATE advisory_advisors SET status = 'approved', fee_bps = ?, decline_note = '', decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?")
    .bind(fee, userId, iso, iso, a.id)
    .run();
  if (a.status === "pending")
    send(env, decisionEmail(env, { to: a.email, approved: true, label: settings.label, note: "", url: `${appUrl(c)}${ADVISORY_HOME}/me` }), defer(c));
  return c.json({ ok: true });
});

manageRoutes.post("/companies/:cid/manage/advisors/:aid/decline", async (c) => {
  const { cid, userId, env, a } = await managedAdvisor(c);
  if (a.status !== "pending") throw new HttpError(400, "Only a profile that waits for review can be declined. Pause a live profile instead.");
  const body = await readJson(c);
  const note = text(body.note, "Note", { max: LIMITS.note });
  const iso = nowIso();
  await env.DB.prepare("UPDATE advisory_advisors SET status = 'declined', decline_note = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?")
    .bind(note, userId, iso, iso, a.id)
    .run();
  const settings = await loadSettings(env, cid);
  send(env, decisionEmail(env, { to: a.email, approved: false, label: settings.label, note, url: `${appUrl(c)}${ADVISORY_HOME}/me` }), defer(c));
  return c.json({ ok: true });
});

/** Changes an advisor's fee, or pauses and lists a live profile. A new fee applies to requests accepted after the change. */
manageRoutes.patch("/companies/:cid/manage/advisors/:aid", async (c) => {
  const { env, a } = await managedAdvisor(c);
  const body = await readJson(c);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.feePercent !== undefined) {
    sets.push("fee_bps = ?");
    binds.push(readFee(body.feePercent));
  }
  if (body.status !== undefined) {
    const status = oneOf(body.status, "Status", ["approved", "paused"] as const);
    if (status === "approved" && a.status !== "paused") throw new HttpError(400, "Approve a profile that waits for review with the Approve button.");
    if (status === "paused" && a.status !== "approved") throw new HttpError(400, "Only a live profile can be paused.");
    sets.push("status = ?");
    binds.push(status);
  }
  if (!sets.length) return c.json({ ok: true });
  await env.DB.prepare(`UPDATE advisory_advisors SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...binds, nowIso(), a.id).run();
  return c.json({ ok: true });
});
