import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import type { Company } from "../shared/types";
import { COMPANY_NAME_MAX, ENTITY_TYPES, ONBOARDING_KINDS, type OnboardingState } from "../shared/onboarding";
import { runHook } from "./apps";
import { MAX_COMPANIES_PER_PERSON } from "./company-copy";
import { siteState } from "./site-state";
import { listWorkspaces } from "./workspaces";
import { HttpError, newId, nowIso, oneOf, readJson, requireUser, text } from "./util";

/*
 * Onboarding: a new person with no company sets one up.
 * It runs when the site setting is on (the default) and the person has no company of any role.
 * A person who joined through an invitation has a company already, so they never see it.
 * docs/onboarding.md has the rules.
 */

export const onboardingRoutes = new Hono<AppEnv>();

const isOn = () => siteState()?.onboardingOn !== false;

async function hasCompany(env: Env, userId: string): Promise<boolean> {
  return !!(await env.DB.prepare("SELECT 1 AS ok FROM company_members WHERE user_id = ? LIMIT 1").bind(userId).first());
}

/** Does this person need to set up a company now? */
onboardingRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const state: OnboardingState = { required: isOn() && !(await hasCompany(c.env, user.id)) };
  return c.json(state);
});

/**
 * Makes the person's company. Body: { legalName, entityType, brand, brandKind }
 * The company is an ordinary company, also on a partner host. The person is its owner.
 * The default workspace takes the brand name and kind.
 */
onboardingRoutes.post("/", async (c) => {
  const user = requireUser(c);
  if (!isOn()) throw new HttpError(400, "Onboarding is off on this site. Use New company in the menu.", "onboarding_off");
  if (await hasCompany(c.env, user.id)) throw new HttpError(409, "You are in a company already. Use New company in the menu to make another.", "has_company");
  const body = await readJson(c);
  const legalName = text(body.legalName, "Official company name", { max: COMPANY_NAME_MAX, required: true });
  const entityType = oneOf(body.entityType, "Company type", ENTITY_TYPES);
  const brand = text(body.brand, "Brand or business unit", { max: COMPANY_NAME_MAX, required: true });
  const brandKind = body.brandKind === undefined ? "brand" : oneOf(body.brandKind, "Kind", ONBOARDING_KINDS);
  const owned = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM company_members WHERE user_id = ? AND role = 'owner'").bind(user.id).first<{ n: number }>();
  if ((owned?.n ?? 0) >= MAX_COMPANIES_PER_PERSON) throw new HttpError(400, `You own ${MAX_COMPANIES_PER_PERSON} companies, which is the limit.`);

  const id = newId();
  const iso = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO companies (id, name, legal_name, entity_type, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      id,
      legalName,
      legalName,
      entityType,
      user.id,
      iso,
      iso
    ),
    c.env.DB.prepare("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(id, user.id, iso),
    // A trigger made the default workspace with the company. It takes the brand name and kind.
    c.env.DB.prepare("UPDATE workspaces SET name = ?, kind = ?, updated_at = ? WHERE company_id = ? AND is_default = 1").bind(brand, brandKind, iso, id),
    c.env.DB.prepare(
      "UPDATE users SET current_company_id = ?, current_workspace_id = (SELECT id FROM workspaces WHERE company_id = ? AND is_default = 1) WHERE id = ?"
    ).bind(id, id, user.id)
  ]);
  await runHook("companyCreated", c.env, id, user.id);
  const company: Company = { id, name: legalName, role: "owner", logoUrl: null, workspaces: (await listWorkspaces(c.env, [id])).get(id) ?? [] };
  return c.json({ company }, 201);
});
