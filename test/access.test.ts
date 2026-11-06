import { test } from "node:test";
import assert from "node:assert/strict";
import { canManageCompany, effectiveProjectRole, emailDomainProblem } from "../apps/projects/src/shared/access.ts";

const role = (visibility: "company" | "secret", projectRole: "owner" | "editor" | "viewer" | null, companyRole: "owner" | "admin" | "member" | "guest" | null) =>
  effectiveProjectRole({ visibility, projectRole, companyRole });

test("company projects: members see them, admins manage them, guests need an invite", () => {
  assert.equal(role("company", null, "member"), "viewer");
  assert.equal(role("company", null, "admin"), "owner");
  assert.equal(role("company", null, "owner"), "owner");
  assert.equal(role("company", null, "guest"), null);
  assert.equal(role("company", null, null), null);
  assert.equal(role("company", "editor", "member"), "editor");
  assert.equal(role("company", "viewer", "guest"), "viewer");
  assert.equal(role("company", "viewer", "admin"), "owner");
});

test("secret projects: only their own members, whatever the company role", () => {
  assert.equal(role("secret", null, "owner"), null);
  assert.equal(role("secret", null, "admin"), null);
  assert.equal(role("secret", null, "member"), null);
  assert.equal(role("secret", "viewer", "admin"), "viewer");
  assert.equal(role("secret", "editor", "guest"), "editor");
});

test("who can manage the company", () => {
  assert.deepEqual(["owner", "admin", "member", "guest", null].map((r) => canManageCompany(r as never)), [true, true, false, false, false]);
});

test("members without projects.browse see only projects they are on", () => {
  const r = (projectRole: "viewer" | null) => effectiveProjectRole({ visibility: "company", projectRole, companyRole: "member", canBrowse: false });
  assert.equal(r(null), null);
  assert.equal(r("viewer"), "viewer");
  assert.equal(effectiveProjectRole({ visibility: "company", projectRole: null, companyRole: "admin", canBrowse: false }), "owner");
});

test("auto-join domains must be real, private and the admin's own", () => {
  assert.equal(emailDomainProblem("acme.com", "maya@acme.com"), null);
  assert.match(emailDomainProblem("gmail.com", "maya@gmail.com")!, /Public email domains/);
  assert.match(emailDomainProblem("acme.com", "maya@other.com")!, /Your own email must use acme.com/);
  assert.match(emailDomainProblem("@acme", "maya@acme.com")!, /Type a domain/);
  assert.match(emailDomainProblem("not a domain", "x@y.com")!, /Type a domain/);
});
