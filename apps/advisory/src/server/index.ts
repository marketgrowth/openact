import { HttpError, defineServerApp, deletePrefix, nowIso, oneOf } from "@openact/core/server";
import { APPROVAL_MODES, CURRENCIES } from "../shared/types";
import { LIMITS, cleanLabel, feeProblem, percentToBps } from "../shared/rules";
import { API, loadSettings, paymentsOn, type AdvisoryEnv } from "./data";
import { clientRoutes } from "./routes";
import { advisorRoutes } from "./advisor";
import { manageRoutes } from "./manage";
import { paymentRoutes } from "./payments";

/*
 * The Advisory app, part of OpenAct Director.
 * A company runs a marketplace of approved advisors. Members hire advisors, or apply to become one.
 * Clients pay through Stripe Connect, and the company keeps a fee on each payment.
 * A paid engagement opens a secret project in the Projects app.
 */

export default defineServerApp({
  id: "advisory",
  name: "Advisory",
  permissions: {
    "advisory.browse": {
      label: "Hire advisors",
      description: "See the listed advisors and their offers, ask for a consult, and pay for an offer.",
      roles: ["owner", "admin", "member"],
      locked: ["owner", "admin"]
    },
    "advisory.sell": {
      label: "Sell as an advisor",
      description: "Write a profile and offers, apply to be listed, connect Stripe, and answer requests.",
      roles: ["owner", "admin", "member"]
    },
    "advisory.manage": {
      label: "Manage advisors",
      description: "Approve or decline applications, set each advisor's fee, pause profiles, and see every engagement.",
      roles: ["owner", "admin"],
      locked: ["owner"]
    }
  },
  routes: (app) => {
    app.route(API, clientRoutes);
    app.route(API, advisorRoutes);
    app.route(API, manageRoutes);
    app.route(API, paymentRoutes);
  },
  hooks: {
    // Company settings, on the Advisory tab.
    companyDetail: async (env, companyId) => ({ advisory: { ...(await loadSettings(env, companyId)), payments: paymentsOn(env as AdvisoryEnv) } }),
    companyUpdate: async (env, companyId, body) => {
      if (body.advisory === undefined) return false;
      const b = body.advisory;
      if (!b || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "Send the Advisory settings as an object.");
      const s = b as Record<string, unknown>;
      const now = await loadSettings(env, companyId);
      const label = s.label === undefined ? now.label : cleanLabel(s.label, now.label);
      const labelPlural = s.labelPlural === undefined ? now.labelPlural : cleanLabel(s.labelPlural, now.labelPlural);
      if (typeof s.label === "string" && s.label.trim().length > LIMITS.label) throw new HttpError(400, `The label is too long. Use ${LIMITS.label} characters or fewer.`);
      const approvalMode = s.approvalMode === undefined ? now.approvalMode : oneOf(s.approvalMode, "Approval", APPROVAL_MODES);
      const currency = s.currency === undefined ? now.currency : oneOf(s.currency, "Currency", CURRENCIES);
      let fee = now.defaultFeePercent;
      if (s.defaultFeePercent !== undefined) {
        const p = feeProblem(s.defaultFeePercent);
        if (p) throw new HttpError(400, p);
        fee = s.defaultFeePercent as number;
      }
      await env.DB.prepare(
        `INSERT INTO advisory_settings (company_id, label, label_plural, approval_mode, default_fee_bps, currency, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (company_id) DO UPDATE SET label = excluded.label, label_plural = excluded.label_plural, approval_mode = excluded.approval_mode,
           default_fee_bps = excluded.default_fee_bps, currency = excluded.currency, updated_at = excluded.updated_at`
      )
        .bind(companyId, label, labelPlural, approvalMode, percentToBps(fee), currency, nowIso())
        .run();
      return true;
    },
    // A person who leaves the company leaves the directory. Their open requests close. Paid engagements stay as records.
    companyMemberRemoved: async (env, companyId, userId) => {
      const iso = nowIso();
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE advisory_requests SET status = 'canceled', updated_at = ?, decided_at = COALESCE(decided_at, ?)
           WHERE company_id = ? AND status IN ('pending', 'accepted')
             AND (client_id = ? OR advisor_id IN (SELECT id FROM advisory_advisors WHERE company_id = ? AND user_id = ?))`
        ).bind(iso, iso, companyId, userId, companyId, userId),
        env.DB.prepare("UPDATE advisory_advisors SET status = 'paused', updated_at = ? WHERE company_id = ? AND user_id = ? AND status IN ('approved', 'pending')").bind(
          iso,
          companyId,
          userId
        )
      ]);
    },
    userDeleting: async (env, userId) => {
      const rows = await env.DB.prepare("SELECT photo_key FROM advisory_advisors WHERE user_id = ? AND photo_key IS NOT NULL").bind(userId).all<{ photo_key: string }>();
      if (rows.results.length) await env.FILES.delete(rows.results.map((r) => r.photo_key));
    },
    companyDeleting: async (env, companyId) => {
      await deletePrefix(env.FILES, `advisory/${companyId}/`);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM advisory_engagements WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM advisory_requests WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM advisory_offers WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM advisory_advisors WHERE company_id = ?").bind(companyId),
        env.DB.prepare("DELETE FROM advisory_settings WHERE company_id = ?").bind(companyId)
      ]);
    }
  }
});
