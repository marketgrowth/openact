import { test } from "node:test";
import assert from "node:assert/strict";
import { MARK, alphaSnapshot, twoCompanies, type Side } from "./harness/companies.ts";
import type { Deploy, Person } from "./harness/deploy.ts";

/*
 * The cross-company suite. Two companies share one deploy, as they do on GTM Matters, DirectCare or SideHustle.
 * A Beta person calls every route with Alpha's ids. Every call must be refused, no answer may hold Alpha data,
 * and Alpha's rows must not change.
 *
 * Every route needs at least one case below. A new route without a case fails this test, so add a case
 * when you add a route. See docs/security.md.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Case, CaseModule, Who } from "./harness/cases.ts";

const DENIED = new Set([401, 403, 404]);

const file = (name: string) => {
  const f = new FormData();
  f.set("file", new File(["x"], name, { type: "image/png" }));
  return f;
};

const CASES: Case[] = [
  // Public and sign-in routes. They hold no company data.
  { route: "GET /api/config", path: () => "/api/config", who: "none", expect: "any" },
  { route: "POST /api/auth/request-code", path: () => "/api/auth/request-code", who: "none", body: () => ({ email: "new@beta.test" }), expect: "any" },
  { route: "POST /api/auth/verify", path: () => "/api/auth/verify", who: "none", body: (a) => ({ email: a.owner.email, code: "000000" }), expect: "any" },
  { route: "POST /api/auth/logout", path: () => "/api/auth/logout", who: "extra", expect: "any" },
  { route: "GET /api/health", path: () => "/api/health", who: "none", expect: "any" },
  { route: "GET /.well-known/oauth-authorization-server", path: () => "/.well-known/oauth-authorization-server", who: "none", expect: "any" },
  { route: "GET /.well-known/oauth-protected-resource", path: () => "/.well-known/oauth-protected-resource", who: "none", expect: "any" },
  { route: "GET /.well-known/oauth-protected-resource/mcp", path: () => "/.well-known/oauth-protected-resource/mcp", who: "none", expect: "any" },
  { route: "GET /.well-known/mcp/server-card.json", path: () => "/.well-known/mcp/server-card.json", who: "none", expect: "any" },
  { route: "POST /oauth/register", path: () => "/oauth/register", who: "none", body: () => ({ client_name: "Test", redirect_uris: ["https://client.test/cb"] }), expect: "any" },
  { route: "POST /oauth/token", path: () => "/oauth/token", who: "none", body: () => ({ grant_type: "authorization_code", code: "x" }), expect: "any" },
  { route: "POST /oauth/revoke", path: () => "/oauth/revoke", who: "none", body: () => ({ token: "x" }), expect: "any" },
  { route: "POST /mcp", path: () => "/mcp", who: "beta", body: () => ({ jsonrpc: "2.0", id: 1, method: "tools/list" }), expect: "denied", why: "A session cookie is not an MCP token." },
  { route: "GET /mcp", path: () => "/mcp", who: "beta", expect: "any" },
  { route: "DELETE /mcp", path: () => "/mcp", who: "beta", expect: "any" },
  { route: "POST /mcp/public", path: () => "/mcp/public", who: "none", body: () => ({ jsonrpc: "2.0", id: 1, method: "tools/list" }), expect: "any" },
  { route: "GET /mcp/public", path: () => "/mcp/public", who: "none", expect: "any" },
  { route: "POST /api/billing/stripe-webhook", path: () => "/api/billing/stripe-webhook", who: "none", body: () => ({}), expect: "denied" },

  // The signed-in person's own account. Lists must hold only Beta data.
  { route: "GET /api/me", path: () => "/api/me", expect: "any" },
  { route: "PATCH /api/me", path: () => "/api/me", body: () => ({ name: "Beta Owner" }), expect: "any" },
  { route: "POST /api/me/sign-out-everywhere", path: () => "/api/me/sign-out-everywhere", who: "extra", expect: "any" },
  { route: "DELETE /api/me", path: () => "/api/me", who: "extra", expect: "any" },
  { route: "GET /api/me/ai", path: () => "/api/me/ai", expect: "any" },
  { route: "PUT /api/me/ai", path: () => "/api/me/ai", body: () => ({ provider: "anthropic", apiKey: "sk-test" }), expect: "any" },
  { route: "DELETE /api/me/ai", path: () => "/api/me/ai", expect: "any" },
  { route: "GET /api/me/agents", path: () => "/api/me/agents", expect: "any" },
  { route: "DELETE /api/me/agents/:id", path: () => "/api/me/agents/not-a-grant", expect: "any" },
  { route: "GET /api/oauth/authorize", path: () => "/api/oauth/authorize?client_id=x", expect: "any" },
  { route: "POST /api/oauth/authorize", path: () => "/api/oauth/authorize", body: () => ({ client_id: "x" }), expect: "any" },
  { route: "POST /api/billing/checkout-sync", path: () => "/api/billing/checkout-sync", body: () => ({ sessionId: "cs_test" }), expect: "any" },
  { route: "GET /api/companies", path: () => "/api/companies", expect: "any" },
  { route: "POST /api/companies", path: () => "/api/companies", body: () => ({ name: "Beta Two" }), expect: "any" },
  { route: "GET /api/projects", path: () => "/api/projects", expect: "any" },
  { route: "GET /api/projects", path: (a) => `/api/projects?companyId=${a.companyId}`, expect: "any", why: "A company id in the query must not list Alpha projects." },
  { route: "GET /api/search", path: () => `/api/search?q=${MARK}`, expect: "any", why: "Vector hits for Alpha tasks must be dropped." },

  // Site settings: only super admins. Beta's owner is not one.
  { route: "GET /api/site/director", path: () => "/api/site/director", expect: "denied" },
  { route: "POST /api/site/director/checkout", path: () => "/api/site/director/checkout", body: () => ({}), expect: "denied" },
  { route: "POST /api/site/director/claim", path: () => "/api/site/director/claim", body: () => ({}), expect: "denied" },
  { route: "POST /api/site/director/link", path: () => "/api/site/director/link", body: () => ({}), expect: "denied" },
  {
    route: "GET /api/site/director/link-proof",
    path: () => "/api/site/director/link-proof",
    who: "none",
    expect: "any",
    why: "Public by design. It shows only the hash of the site's claim token, never company data."
  },
  { route: "PUT /api/site/director/license", path: () => "/api/site/director/license", body: () => ({ key: "x" }), expect: "denied" },
  { route: "DELETE /api/site/director/license", path: () => "/api/site/director/license", expect: "denied" },
  { route: "POST /api/site/director/github", path: () => "/api/site/director/github", body: () => ({}), expect: "denied" },
  { route: "GET /api/site/director/repos", path: () => "/api/site/director/repos", expect: "denied" },
  { route: "POST /api/site/director/install", path: () => "/api/site/director/install", body: () => ({}), expect: "denied" },
  { route: "GET /api/site", path: () => "/api/site", expect: "any" },
  { route: "PATCH /api/site", path: () => "/api/site", body: () => ({ appName: "x" }), expect: "denied" },
  { route: "GET /api/onboarding", path: () => "/api/onboarding", expect: "any" },
  { route: "POST /api/onboarding", path: () => "/api/onboarding", body: () => ({ legalName: "Beta Co", entityType: "llc", brand: "Beta", brandKind: "brand" }), expect: "any", why: "Beta's owner is in a company already, so the route refuses." },
  { route: "GET /api/invitations", path: () => "/api/invitations", expect: "any" },
  { route: "POST /api/invitations/:id/accept", path: (a) => `/api/invitations/${a.companyInvitationId}/accept`, expect: "denied", why: "The invitation is for another email." },
  { route: "POST /api/invitations/:id/decline", path: (a) => `/api/invitations/${a.companyInvitationId}/decline`, expect: "denied", why: "The invitation is for another email." },
  { route: "POST /api/site/companies/invite", path: () => "/api/site/companies/invite", body: () => ({ legalName: "X Co", entityType: "llc", email: "x@x.test" }), expect: "denied" },
  { route: "PATCH /api/site/onboarding", path: () => "/api/site/onboarding", body: () => ({ enabled: false }), expect: "denied" },
  { route: "PATCH /api/site/issues", path: () => "/api/site/issues", body: () => ({ url: "https://x.test" }), expect: "denied" },
  { route: "PATCH /api/site/apps/:appId", path: () => "/api/site/apps/projects", body: () => ({ enabled: false }), expect: "denied" },
  { route: "GET /api/site/companies", path: () => "/api/site/companies", expect: "denied" },
  { route: "PUT /api/site/companies/:companyId/apps/:appId", path: (a) => `/api/site/companies/${a.companyId}/apps/projects`, body: () => ({ blocked: true }), expect: "denied" },
  { route: "POST /api/site/companies/:companyId/duplicate", path: (a) => `/api/site/companies/${a.companyId}/duplicate`, body: () => ({ name: "copy" }), expect: "denied" },
  { route: "PATCH /api/site/sign-in", path: () => "/api/site/sign-in", body: () => ({}), expect: "denied" },
  { route: "GET /api/site/sign-in-background", path: () => "/api/site/sign-in-background", expect: "any" },
  { route: "PUT /api/site/sign-in-background", path: () => "/api/site/sign-in-background", body: () => file("bg.png"), expect: "denied" },
  { route: "DELETE /api/site/sign-in-background", path: () => "/api/site/sign-in-background", expect: "denied" },
  { route: "GET /api/site/logo", path: () => "/api/site/logo", expect: "any" },
  { route: "GET /api/site/partners", path: () => "/api/site/partners", expect: "denied" },
  { route: "POST /api/site/partners", path: () => "/api/site/partners", body: (a) => ({ host: "app.beta-agency.test", companyId: a.companyId }), expect: "denied" },
  { route: "PATCH /api/site/partners/:host", path: () => "/api/site/partners/app.alpha-agency.test", body: () => ({ name: "Taken" }), expect: "denied" },
  { route: "DELETE /api/site/partners/:host", path: () => "/api/site/partners/app.alpha-agency.test", expect: "denied" },
  { route: "PUT /api/site/partners/company/:companyId", path: (a) => `/api/site/partners/company/${a.companyId}`, body: () => ({ paused: true }), expect: "denied" },
  { route: "GET /api/site/partners/company/:companyId/clients", path: (a) => `/api/site/partners/company/${a.companyId}/clients`, expect: "denied" },
  {
    route: "POST /api/site/partners/clients/:companyId/handover",
    path: (a) => `/api/site/partners/clients/${a.companyId}/handover`,
    body: (_a, b) => ({ userId: b.owner.id }),
    expect: "denied"
  },
  {
    route: "GET /api/partner/logo",
    path: () => "/api/partner/logo",
    who: "none",
    expect: "any",
    why: "Public by design. It serves only the logo of the partner of the request's own host. The test host is not a partner."
  },
  { route: "PUT /api/site/logo", path: () => "/api/site/logo", body: () => file("logo.png"), expect: "denied" },
  { route: "DELETE /api/site/logo", path: () => "/api/site/logo", expect: "denied" },
  { route: "PATCH /api/site/plans/:planId", path: () => "/api/site/plans/director", body: () => ({ description: "x" }), expect: "denied" },
  { route: "GET /api/site/grants", path: () => "/api/site/grants", expect: "denied" },
  { route: "PUT /api/site/grants/:userId/:appId", path: (_a, b) => `/api/site/grants/${b.owner.id}/projects`, body: () => ({}), expect: "denied" },
  { route: "DELETE /api/site/grants/:userId/:appId", path: (a) => `/api/site/grants/${a.owner.id}/projects`, expect: "denied" },

  // Alpha's company, called by Beta's owner.
  { route: "POST /api/companies/:id/switch", path: (a) => `/api/companies/${a.companyId}/switch`, expect: "denied" },
  { route: "GET /api/companies/:id", path: (a) => `/api/companies/${a.companyId}`, expect: "denied" },
  { route: "PATCH /api/companies/:id", path: (a) => `/api/companies/${a.companyId}`, body: () => ({ name: "Taken" }), expect: "denied" },
  { route: "DELETE /api/companies/:id", path: (a) => `/api/companies/${a.companyId}`, expect: "denied" },
  { route: "GET /api/companies/:id/logo", path: (a) => `/api/companies/${a.companyId}/logo`, expect: "denied" },
  { route: "GET /api/companies/:id/clients", path: (a) => `/api/companies/${a.companyId}/clients`, expect: "denied" },
  { route: "PUT /api/companies/:id/logo", path: (a) => `/api/companies/${a.companyId}/logo`, body: () => file("logo.png"), expect: "denied" },
  { route: "DELETE /api/companies/:id/logo", path: (a) => `/api/companies/${a.companyId}/logo`, expect: "denied" },
  { route: "POST /api/companies/:id/members", path: (a) => `/api/companies/${a.companyId}/members`, body: (_a, b) => ({ email: b.member.email, role: "owner" }), expect: "denied" },
  { route: "PATCH /api/companies/:id/members/:userId", path: (a) => `/api/companies/${a.companyId}/members/${a.member.id}`, body: () => ({ role: "owner" }), expect: "denied" },
  { route: "PATCH /api/companies/:id/members/:userId", path: (a, b) => `/api/companies/${b.companyId}/members/${a.member.id}`, body: () => ({ role: "owner" }), expect: "denied", why: "Beta's company with an Alpha person." },
  { route: "DELETE /api/companies/:id/members/:userId", path: (a) => `/api/companies/${a.companyId}/members/${a.member.id}`, expect: "denied" },
  { route: "DELETE /api/companies/:id/members/:userId", path: (a, b) => `/api/companies/${b.companyId}/members/${a.member.id}`, expect: "denied", why: "Beta's company with an Alpha person." },
  { route: "DELETE /api/companies/:id/invitations/:invId", path: (a) => `/api/companies/${a.companyId}/invitations/${a.companyInvitationId}`, expect: "denied" },
  { route: "DELETE /api/companies/:id/invitations/:invId", path: (a, b) => `/api/companies/${b.companyId}/invitations/${a.companyInvitationId}`, expect: "denied", why: "Beta's company with an Alpha invitation." },
  { route: "GET /api/companies/:id/workspaces", path: (a) => `/api/companies/${a.companyId}/workspaces`, expect: "denied" },
  { route: "POST /api/companies/:id/workspaces", path: (a) => `/api/companies/${a.companyId}/workspaces`, body: () => ({ name: "Taken", kind: "brand" }), expect: "denied" },
  { route: "PATCH /api/companies/:id/workspaces/:wid", path: (a) => `/api/companies/${a.companyId}/workspaces/${a.workspaceId}`, body: () => ({ name: "Taken" }), expect: "denied" },
  { route: "PATCH /api/companies/:id/workspaces/:wid", path: (a, b) => `/api/companies/${b.companyId}/workspaces/${a.workspaceId}`, body: () => ({ name: "Taken" }), expect: "denied", why: "Beta's company with an Alpha workspace." },
  { route: "POST /api/companies/:id/workspaces/:wid/switch", path: (a) => `/api/companies/${a.companyId}/workspaces/${a.workspaceId}/switch`, expect: "denied" },
  { route: "POST /api/companies/:id/workspaces/:wid/switch", path: (a, b) => `/api/companies/${b.companyId}/workspaces/${a.workspaceId}/switch`, expect: "denied", why: "Beta's company with an Alpha workspace." },
  { route: "GET /api/companies/:id/workspaces/:wid/members", path: (a) => `/api/companies/${a.companyId}/workspaces/${a.workspaceId}/members`, expect: "denied" },
  { route: "GET /api/companies/:id/workspaces/:wid/members", path: (a, b) => `/api/companies/${b.companyId}/workspaces/${a.workspaceId}/members`, expect: "denied", why: "Beta's company with an Alpha workspace." },
  { route: "POST /api/companies/:id/workspaces/:wid/members", path: (a) => `/api/companies/${a.companyId}/workspaces/${a.workspaceId}/members`, body: () => ({ userId: "x" }), expect: "denied" },
  { route: "POST /api/companies/:id/workspaces/:wid/members", path: (a, b) => `/api/companies/${b.companyId}/workspaces/${a.workspaceId}/members`, body: () => ({ userId: "x" }), expect: "denied", why: "Beta's company with an Alpha workspace." },
  { route: "DELETE /api/companies/:id/workspaces/:wid/members/:userId", path: (a) => `/api/companies/${a.companyId}/workspaces/${a.workspaceId}/members/x`, expect: "denied" },
  { route: "DELETE /api/companies/:id/workspaces/:wid/members/:userId", path: (a, b) => `/api/companies/${b.companyId}/workspaces/${a.workspaceId}/members/x`, expect: "denied", why: "Beta's company with an Alpha workspace." },
  { route: "POST /api/companies/:id/workspaces/:wid/invite", path: (a) => `/api/companies/${a.companyId}/workspaces/${a.workspaceId}/invite`, body: () => ({ email: "new@x.test" }), expect: "denied" },
  { route: "POST /api/companies/:id/workspaces/:wid/invite", path: (a, b) => `/api/companies/${b.companyId}/workspaces/${a.workspaceId}/invite`, body: () => ({ email: "new@x.test" }), expect: "denied", why: "Beta's company with an Alpha workspace." },
  { route: "GET /api/companies/:id/workspaces/:wid/logo", path: (a) => `/api/companies/${a.companyId}/workspaces/${a.workspaceId}/logo`, expect: "denied" },
  { route: "PUT /api/companies/:id/workspaces/:wid/logo", path: (a) => `/api/companies/${a.companyId}/workspaces/${a.workspaceId}/logo`, body: () => file("ws.png"), expect: "denied" },
  { route: "PUT /api/companies/:id/workspaces/:wid/logo", path: (a, b) => `/api/companies/${b.companyId}/workspaces/${a.workspaceId}/logo`, body: () => file("ws.png"), expect: "denied", why: "Beta's company with an Alpha workspace." },
  { route: "DELETE /api/companies/:id/workspaces/:wid/logo", path: (a) => `/api/companies/${a.companyId}/workspaces/${a.workspaceId}/logo`, expect: "denied" },
  { route: "GET /api/companies/:id/access", path: (a) => `/api/companies/${a.companyId}/access`, expect: "denied" },
  { route: "GET /api/companies/:id/apps", path: (a) => `/api/companies/${a.companyId}/apps`, expect: "denied" },
  { route: "PATCH /api/companies/:id/apps/:appId", path: (a) => `/api/companies/${a.companyId}/apps/projects`, body: () => ({ enabled: false }), expect: "denied" },
  { route: "GET /api/companies/:id/ai", path: (a) => `/api/companies/${a.companyId}/ai`, expect: "denied" },
  { route: "PUT /api/companies/:id/ai", path: (a) => `/api/companies/${a.companyId}/ai`, body: () => ({ provider: "anthropic", apiKey: "sk-test" }), expect: "denied" },
  { route: "DELETE /api/companies/:id/ai", path: (a) => `/api/companies/${a.companyId}/ai`, expect: "denied" },
  { route: "GET /api/companies/:id/keys", path: (a) => `/api/companies/${a.companyId}/keys`, expect: "denied" },
  { route: "PUT /api/companies/:id/keys/:service", path: (a) => `/api/companies/${a.companyId}/keys/typesafe`, body: () => ({ apiKey: "ts-planted-key-0000000000" }), expect: "denied" },
  { route: "DELETE /api/companies/:id/keys/:service", path: (a) => `/api/companies/${a.companyId}/keys/typesafe`, expect: "denied" },
  { route: "PUT /api/companies/:id/ai/member-keys", path: (a) => `/api/companies/${a.companyId}/ai/member-keys`, body: () => ({ allowed: false }), expect: "denied" },
  { route: "GET /api/companies/:id/plan", path: (a) => `/api/companies/${a.companyId}/plan`, expect: "denied" },
  { route: "POST /api/companies/:id/plan/checkout", path: (a) => `/api/companies/${a.companyId}/plan/checkout`, body: () => ({ planId: "director" }), expect: "denied" },
  { route: "POST /api/companies/:id/plan/portal", path: (a) => `/api/companies/${a.companyId}/plan/portal`, body: () => ({}), expect: "denied" },

  // Alpha's project, tasks, columns and files, called by Beta's owner.
  { route: "POST /api/projects", path: () => "/api/projects", body: (a) => ({ name: "Planted", companyId: a.companyId }), expect: "denied" },
  { route: "GET /api/projects/:id/live", path: (a) => `/api/projects/${a.projectId}/live`, headers: { upgrade: "websocket" }, expect: "denied" },
  { route: "PUT /api/projects/:id/pin", path: (a) => `/api/projects/${a.projectId}/pin`, expect: "denied" },
  { route: "DELETE /api/projects/:id/pin", path: (a) => `/api/projects/${a.projectId}/pin`, expect: "any", why: "Removes only the caller's own pin." },
  { route: "POST /api/projects/:id/tasks/:taskId/opened", path: (a) => `/api/projects/${a.projectId}/tasks/${a.taskId}/opened`, expect: "denied" },
  { route: "POST /api/projects/:id/tasks/:taskId/opened", path: (a, b) => `/api/projects/${b.projectId}/tasks/${a.taskId}/opened`, expect: "denied", why: "Beta's project with an Alpha task." },
  { route: "GET /api/projects/:id", path: (a) => `/api/projects/${a.projectId}`, expect: "denied" },
  { route: "GET /api/projects/:id/rev", path: (a) => `/api/projects/${a.projectId}/rev`, expect: "denied" },
  { route: "PATCH /api/projects/:id", path: (a) => `/api/projects/${a.projectId}`, body: () => ({ name: "Taken" }), expect: "denied" },
  { route: "PATCH /api/projects/:id", path: (_a, b) => `/api/projects/${b.projectId}`, body: (a) => ({ workspaceId: a.workspaceId }), expect: "any", why: "Beta's project must not move into an Alpha workspace." },
  { route: "DELETE /api/projects/:id", path: (a) => `/api/projects/${a.projectId}`, expect: "denied" },
  { route: "POST /api/projects/:id/members", path: (a) => `/api/projects/${a.projectId}/members`, body: (_a, b) => ({ email: b.owner.email, role: "owner" }), expect: "denied" },
  { route: "PATCH /api/projects/:id/members/:userId", path: (a) => `/api/projects/${a.projectId}/members/${a.owner.id}`, body: () => ({ role: "viewer" }), expect: "denied" },
  { route: "PATCH /api/projects/:id/members/:userId", path: (a, b) => `/api/projects/${b.projectId}/members/${a.owner.id}`, body: () => ({ role: "viewer" }), expect: "denied", why: "Beta's project with an Alpha person." },
  { route: "DELETE /api/projects/:id/members/:userId", path: (a) => `/api/projects/${a.projectId}/members/${a.owner.id}`, expect: "denied" },
  { route: "DELETE /api/projects/:id/invitations/:invId", path: (a) => `/api/projects/${a.projectId}/invitations/${a.projectInvitationId}`, expect: "denied" },
  { route: "DELETE /api/projects/:id/invitations/:invId", path: (a, b) => `/api/projects/${b.projectId}/invitations/${a.projectInvitationId}`, expect: "denied", why: "Beta's project with an Alpha invitation." },
  { route: "PATCH /api/projects/:id/ai-policy", path: (a) => `/api/projects/${a.projectId}/ai-policy`, body: () => ({ readNotes: true }), expect: "denied" },
  { route: "GET /api/projects/:id/agent-actions", path: (a) => `/api/projects/${a.projectId}/agent-actions`, expect: "denied" },
  { route: "GET /api/projects/:id/access", path: (a) => `/api/projects/${a.projectId}/access`, expect: "any", why: "May say that access is needed, without Alpha's names." },
  {
    route: "POST /api/projects/:id/access-requests",
    path: (a) => `/api/projects/${a.projectId}/access-requests`,
    body: () => ({ note: "let me in" }),
    expect: "any",
    why: "By design, a person with a project link can ask for access. The owners decide. The answer holds no Alpha data."
  },
  { route: "POST /api/projects/:id/access-requests/:reqId", path: (a) => `/api/projects/${a.projectId}/access-requests/not-a-request`, body: () => ({ approve: true }), expect: "denied" },
  { route: "POST /api/projects/:id/tasks", path: (a) => `/api/projects/${a.projectId}/tasks`, body: () => ({ title: "Planted" }), expect: "denied" },
  { route: "POST /api/projects/:id/tasks/bulk", path: (a) => `/api/projects/${a.projectId}/tasks/bulk`, body: () => ({ tasks: [{ title: "Planted" }] }), expect: "denied" },
  { route: "POST /api/projects/:id/columns", path: (a) => `/api/projects/${a.projectId}/columns`, body: () => ({ name: "Planted" }), expect: "denied" },
  { route: "POST /api/projects/:id/ai/plan", path: (a) => `/api/projects/${a.projectId}/ai/plan`, body: () => ({ goal: "x" }), expect: "denied" },
  { route: "POST /api/projects/:id/ai/summary", path: (a) => `/api/projects/${a.projectId}/ai/summary`, body: () => ({}), expect: "denied" },
  { route: "POST /api/projects/:id/agent", path: (a) => `/api/projects/${a.projectId}/agent`, body: () => ({ messages: [{ role: "user", content: "list tasks" }] }), expect: "denied" },
  { route: "PATCH /api/tasks/:taskId", path: (a) => `/api/tasks/${a.taskId}`, body: () => ({ title: "Taken" }), expect: "denied" },
  { route: "PATCH /api/tasks/:taskId", path: (a) => `/api/tasks/${a.taskId}`, who: "betaMember", body: () => ({ title: "Taken" }), expect: "denied" },
  { route: "DELETE /api/tasks/:taskId", path: (a) => `/api/tasks/${a.taskId}`, expect: "denied" },
  { route: "POST /api/tasks/:taskId/attachments", path: (a) => `/api/tasks/${a.taskId}/attachments`, body: () => file("planted.png"), expect: "denied" },
  { route: "PATCH /api/columns/:columnId", path: (a) => `/api/columns/${a.columnId}`, body: () => ({ name: "Taken" }), expect: "denied" },
  { route: "DELETE /api/columns/:columnId", path: (a) => `/api/columns/${a.columnId}`, expect: "denied" },
  { route: "GET /api/attachments/:id", path: (a) => `/api/attachments/${a.attachmentId}`, expect: "denied" },
  { route: "DELETE /api/attachments/:id", path: (a) => `/api/attachments/${a.attachmentId}`, expect: "denied" },
  { route: "GET /api/search/related/:taskId", path: (a) => `/api/search/related/${a.taskId}`, expect: "denied" }
];

/**
 * More cases, from files in test/cross-company/. Each file exports `cases` and, if its app needs data, `seed`.
 * Apps that live in another repository (such as the Director apps) add their own file there, so this file never changes.
 */
const DIR = join(import.meta.dirname, "cross-company");
const modules: CaseModule[] = await Promise.all(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => import(join(DIR, f)) as Promise<CaseModule>)
);
const ALL_CASES: Case[] = [...CASES, ...modules.flatMap((m) => m.cases)];

async function deployWithData() {
  const world = await twoCompanies();
  for (const m of modules) await m.seed?.(world.d, world.alpha, world.beta);
  return world;
}

/** Every route the deploy serves, as "METHOD /path". */
function routeKeys(d: Deploy): string[] {
  const keys = new Set<string>();
  for (const r of d.app.routes) if (r.method !== "ALL") keys.add(`${r.method} ${r.path}`);
  return [...keys];
}

/** Words that would show Alpha data in an answer to Beta. */
const leaks = (a: Side) => [MARK, a.owner.email, a.member.email, a.companyId, a.projectId, a.taskId];

async function quietly<T>(f: () => Promise<T>): Promise<T> {
  // The test deploy has no email key, so emails go to the console. Keep the test output short.
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return await f();
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

test("every route has a cross-company case", async () => {
  const { d } = await quietly(() => deployWithData());
  const covered = new Set(ALL_CASES.map((c) => c.route));
  const missing = routeKeys(d).filter((k) => !covered.has(k));
  assert.deepEqual(missing, [], `Add a case to test/cross-company.test.ts for: ${missing.join(", ")}`);
});

test("a Beta person cannot read or change Alpha data on any route", async () => {
  const problems: string[] = [];
  await quietly(async () => {
    const { d, alpha, beta } = await deployWithData();
    // Vectorize returns Alpha's task for every query, like a broken index. The app must drop it.
    d.env.VECTORS.store.set(alpha.taskId, { id: alpha.taskId, namespace: alpha.companyId, metadata: { project_id: alpha.projectId } });
    const snap = () => [alphaSnapshot(d, alpha), ...modules.map((m) => m.snapshot?.(d, alpha) ?? "")].join("\n");
    const before = snap();
    const people: Record<Who, Person | null> = { beta: beta.owner, betaMember: beta.member, extra: null, none: null };
    for (const c of ALL_CASES) {
      const who = c.who === "extra" ? d.person(`extra-${Math.random().toString(36).slice(2)}@beta.test`) : people[c.who ?? "beta"];
      const [method] = c.route.split(" ");
      const path = c.path(alpha, beta);
      const r = await d.call(who, method!, path, c.body?.(alpha, beta), c.headers);
      const label = `${c.route} (${path})${c.why ? ` ${c.why}` : ""}`;
      if (c.expect === "denied" && !DENIED.has(r.status)) problems.push(`${label}: expected 401, 403 or 404, got ${r.status} ${r.text.slice(0, 160)}`);
      if (r.status >= 500) problems.push(`${label}: server error ${r.status} ${r.text.slice(0, 160)}`);
      const found = leaks(alpha).find((w) => r.text.includes(w));
      if (found) problems.push(`${label}: the answer holds Alpha data (${found === MARK ? MARK : "an Alpha id or email"})`);
    }
    const after = snap();
    if (before !== after) problems.push(`Alpha's rows changed:\nbefore ${before}\nafter  ${after}`);
  });
  assert.deepEqual(problems, []);
});
