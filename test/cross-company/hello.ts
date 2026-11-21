import assert from "node:assert/strict";
import type { Case } from "../harness/cases.ts";
import type { Side } from "../harness/companies.ts";
import type { Deploy } from "../harness/deploy.ts";

/*
 * The Hello example app. Copy this file for your own app: one case per route, and a seed with Alpha data.
 * Hello is in the deploy only after `npm run openact -- add hello`, so the seed checks that first.
 */

const installed = (d: Deploy) => d.app.routes.some((r) => r.path === "/api/apps/hello/companies/:id/notes");

export async function seed(d: Deploy, alpha: Side): Promise<void> {
  if (!installed(d)) return;
  const r = await d.call(alpha.owner, "POST", `/api/apps/hello/companies/${alpha.companyId}/notes`, { body: "ALPHASECRET hello note" });
  assert.equal(r.status, 201, r.text);
}

export function snapshot(d: Deploy, alpha: Side): string {
  return installed(d) ? JSON.stringify(d.all("SELECT id, body FROM hello_notes WHERE company_id = ? ORDER BY id", alpha.companyId)) : "";
}

export const cases: Case[] = [
  { route: "GET /api/apps/hello/companies/:id/notes", path: (a) => `/api/apps/hello/companies/${a.companyId}/notes`, expect: "denied" },
  { route: "POST /api/apps/hello/companies/:id/notes", path: (a) => `/api/apps/hello/companies/${a.companyId}/notes`, body: () => ({ body: "Planted" }), expect: "denied" }
];
