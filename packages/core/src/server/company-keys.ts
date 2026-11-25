import { Hono } from "hono";
import type { AppEnv, Env } from "./env.ts";
import { COMPANY_KEY_SERVICES, cleanServiceKey, isCompanyKeyService, keyHintOf, type CompanyKeyService, type CompanyKeySettings } from "../shared/ai.ts";
import { requireCompanyRole } from "./data.ts";
import { partnerLink } from "./partner-link.ts";
import { openKey, sealKey } from "./secret-box.ts";
import { HttpError, nowIso, readJson, requireUser } from "./util.ts";

/*
 * Keys for services other than the AI provider, such as TypeSafe (Jev).
 *
 * GET /api/companies/:id/keys: owners and admins. PUT and DELETE /api/companies/:id/keys/:service: owners only,
 * because the key bills the company.
 *
 * Order for each request (companyServiceKey): the company's own key, then for a client company the partner's key,
 * then the deploy's key (such as the TYPESAFE_API_KEY secret). A partner that brings its own AI never gets the
 * deploy's key: without its own key, the service is off for it and its clients. See docs/partners.md.
 *
 * Keys are encrypted with AES-GCM, bound to the company id, with their own purpose. They never go back to the web app.
 */

const purpose = (service: CompanyKeyService) => ({ salt: "openact/company-key", info: `${service} v1` });
const noTable = (e: unknown) => /no such (table|column)/i.test(String(e));

function keySecret(env: Env): string | null {
  if (env.AUTH_SECRET && env.AUTH_SECRET.length >= 16) return env.AUTH_SECRET;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test((env.APP_URL || "").trim())) return "openact-local-development-only";
  return null;
}

type Row = { key_cipher: string; key_hint: string };

async function readRow(env: Env, companyId: string, service: CompanyKeyService): Promise<Row | null> {
  try {
    return await env.DB.prepare("SELECT key_cipher, key_hint FROM company_keys WHERE company_id = ? AND service = ?").bind(companyId, service).first<Row>();
  } catch (e) {
    if (noTable(e)) return null;
    throw e;
  }
}

async function openRow(env: Env, companyId: string, service: CompanyKeyService, row: Row): Promise<string | null> {
  const secret = keySecret(env);
  return secret ? openKey(secret, companyId, row.key_cipher, purpose(service)) : null;
}

/** The deploy's own key for a service, from its secret. */
function deployKey(env: Env, service: CompanyKeyService): string | null {
  if (service === "typesafe") return (env.TYPESAFE_API_KEY || "").trim() || null;
  return null;
}

export interface ServiceKey {
  /** The key to send. Null with source "deploy" means: the deploy has no secret, and a gateway may hold the key. */
  key: string | null;
  /** "none": the service is off for this company. Never call it. */
  source: "company" | "partner" | "deploy" | "none";
}

/** The key that a company uses for a service, by the order above. */
export async function companyServiceKey(env: Env, companyId: string | null | undefined, service: CompanyKeyService): Promise<ServiceKey> {
  if (companyId) {
    const row = await readRow(env, companyId, service);
    const own = row ? await openRow(env, companyId, service, row) : null;
    if (own) return { key: own, source: "company" };
  }
  const link = await partnerLink(env, companyId);
  if (link?.isClient) {
    const row = await readRow(env, link.partnerId, service);
    const theirs = row ? await openRow(env, link.partnerId, service, row) : null;
    if (theirs) return { key: theirs, source: "partner" };
  }
  if (link?.ownAiRequired) return { key: null, source: "none" };
  return { key: deployKey(env, service), source: "deploy" };
}

async function settings(env: Env, companyId: string, canEdit: boolean): Promise<CompanyKeySettings> {
  const link = await partnerLink(env, companyId);
  const keys: CompanyKeySettings["keys"] = [];
  for (const service of COMPANY_KEY_SERVICES) {
    const row = await readRow(env, companyId, service);
    const broken = row ? !(await openRow(env, companyId, service, row)) : false;
    const { source } = await companyServiceKey(env, companyId, service);
    keys.push({ service, keyHint: row?.key_hint ?? null, keyBroken: broken, source });
  }
  return { keys, partnerName: link?.name ?? null, canEdit };
}

export const companyKeyRoutes = new Hono<AppEnv>();

companyKeyRoutes.get("/:id/keys", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const role = await requireCompanyRole(c.env, id, user.id, ["owner", "admin"]);
  return c.json(await settings(c.env, id, role === "owner"));
});

companyKeyRoutes.put("/:id/keys/:service", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner"]);
  const service = c.req.param("service");
  if (!isCompanyKeyService(service)) throw new HttpError(404, "This service does not exist.");
  const r = cleanServiceKey((await readJson(c)).apiKey);
  if ("problem" in r) throw new HttpError(400, r.problem);
  const secret = keySecret(c.env);
  if (!secret) throw new HttpError(500, "The server is missing AUTH_SECRET, so it cannot protect the key. Ask the person who runs this deploy to set it.");
  const sealed = await sealKey(secret, id, r.key, purpose(service));
  try {
    await c.env.DB.prepare(
      `INSERT INTO company_keys (company_id, service, key_cipher, key_hint, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (company_id, service) DO UPDATE SET key_cipher = excluded.key_cipher, key_hint = excluded.key_hint,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    )
      .bind(id, service, sealed, keyHintOf(r.key), user.id, nowIso())
      .run();
  } catch (e) {
    if (noTable(e)) throw new HttpError(503, "The company keys table is missing. Run the database migrations, then try again.");
    throw e;
  }
  return c.json(await settings(c.env, id, true));
});

companyKeyRoutes.delete("/:id/keys/:service", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  await requireCompanyRole(c.env, id, user.id, ["owner"]);
  const service = c.req.param("service");
  if (!isCompanyKeyService(service)) throw new HttpError(404, "This service does not exist.");
  try {
    await c.env.DB.prepare("DELETE FROM company_keys WHERE company_id = ? AND service = ?").bind(id, service).run();
  } catch (e) {
    if (!noTable(e)) throw e;
  }
  return c.json(await settings(c.env, id, true));
});

