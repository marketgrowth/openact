import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedRoles, lockedRoles, permissionApp, permissionRolesProblem, rolesWithPermission } from "../packages/core/src/shared/permissions.ts";

const create = { label: "Create projects", roles: ["owner", "admin", "member"] as const };
const browse = { label: "See all company projects", roles: ["owner", "admin", "member"] as const, locked: ["owner", "admin"] as const };
const read = { label: "Read notes", roles: ["owner", "admin", "member", "guest"] as const, guests: true };
const p = <T>(x: T) => x as never;

test("without a company choice, the app's default roles apply", () => {
  assert.deepEqual(rolesWithPermission(p(create)), ["owner", "admin", "member"]);
});

test("a company choice replaces the default, but the owner always keeps it", () => {
  assert.deepEqual(rolesWithPermission(p(create), ["admin"]), ["owner", "admin"]);
  assert.deepEqual(rolesWithPermission(p(create), []), ["owner"]);
});

test("locked roles always keep the permission", () => {
  assert.deepEqual(rolesWithPermission(p(browse), ["member"]), ["owner", "admin", "member"]);
  assert.deepEqual(lockedRoles(p(browse)), ["owner", "admin"]);
});

test("guests get a permission only when the app allows it", () => {
  assert.deepEqual(rolesWithPermission(p(create), ["member", "guest"]), ["owner", "member"]);
  assert.deepEqual(rolesWithPermission(p(read), ["guest"]), ["owner", "guest"]);
  assert.deepEqual(allowedRoles(p(create)), ["owner", "admin", "member"]);
  assert.match(permissionRolesProblem(p(create), ["guest"])!, /Guests cannot/);
  assert.equal(permissionRolesProblem(p(read), ["guest"]), null);
  assert.match(permissionRolesProblem(p(create), ["boss"])!, /must be a list/);
  assert.match(permissionRolesProblem(p(create), "member")!, /must be a list/);
});

test("a permission id names its app", () => {
  assert.equal(permissionApp("projects.create"), "projects");
  assert.equal(permissionApp("orbytt.talent.search"), "orbytt");
});
