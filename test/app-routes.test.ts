import { test } from "node:test";
import assert from "node:assert/strict";
import { activeApp, appHome, compilePath, guardApps, inAppSpace, isOfficialApp, matchRoute } from "../packages/ui/src/app-paths.ts";

/*
 * Page routes: named paths, params, the older RegExp routes, and the rule that keeps community apps under /a/<id>/.
 */

test("named paths match whole paths, with an optional final slash", () => {
  assert.deepEqual(matchRoute({ path: "/a/academy/mission/:id" }, "/a/academy/mission/m1")?.params, { id: "m1" });
  assert.deepEqual(matchRoute({ path: "/a/academy/mission/:id" }, "/a/academy/mission/m1/")?.params, { id: "m1" });
  assert.equal(matchRoute({ path: "/a/academy/mission/:id" }, "/a/academy/mission"), null);
  assert.equal(matchRoute({ path: "/a/academy/mission/:id" }, "/a/academy/mission/m1/extra"), null);
  assert.equal(matchRoute({ path: "/a/academy" }, "/a/academyx"), null);
  assert.ok(matchRoute({ path: "/" }, "/"));
  assert.equal(matchRoute({ path: "/" }, "/x"), null);
});

test("optional parts, the rest of the path, and decoding", () => {
  const r = { path: "/p/:id/:view?" };
  assert.deepEqual(matchRoute(r, "/p/abc")?.params, { id: "abc", view: undefined });
  assert.deepEqual(matchRoute(r, "/p/abc/timeline")?.params, { id: "abc", view: "timeline" });
  assert.deepEqual(matchRoute(r, "/p/a%20b")?.params, { id: "a b", view: undefined });
  assert.deepEqual(matchRoute({ path: "/a/files/*" }, "/a/files/docs/q1/plan.pdf")?.params, { "*": "docs/q1/plan.pdf" });
  assert.deepEqual(matchRoute({ path: "/a/files/*" }, "/a/files")?.params, { "*": undefined });
  // A bad escape stays as it is, and does not throw.
  assert.deepEqual(matchRoute({ path: "/a/x/:id" }, "/a/x/%E0%A4%A")?.params, { id: "%E0%A4%A" });
});

test("static parts are literal, not RegExp", () => {
  assert.ok(matchRoute({ path: "/a/x/v1.2" }, "/a/x/v1.2"));
  assert.equal(matchRoute({ path: "/a/x/v1.2" }, "/a/x/v1x2"), null);
});

test("paths that cannot work are refused", () => {
  assert.throws(() => compilePath("a/x"), /must start with/);
  assert.throws(() => compilePath("/a/:id?/x"), /only the last part/);
  assert.throws(() => compilePath("/a/*/x"), /must be the last part/);
  assert.throws(() => compilePath("/a/:1d"), /not valid/);
  assert.throws(() => compilePath("/a/:id/:id"), /two times/);
});

test("older RegExp routes still work, and named groups become params", () => {
  const m = matchRoute({ pattern: /^\/p\/([^/]+)(?:\/(board|timeline))?\/?$/ }, "/p/abc/timeline");
  assert.equal(m?.match[1], "abc");
  assert.equal(m?.match[2], "timeline");
  assert.deepEqual(matchRoute({ pattern: /^\/a\/x\/(?<id>\d+)$/ }, "/a/x/42")?.params, { id: "42" });
  assert.equal(matchRoute({ pattern: /^\/p\/x$/ }, "/p/y"), null);
});

const directory = [
  { id: "projects", reserved: true },
  { id: "docs", reserved: true },
  { id: "hello", reserved: false }
];
const trust = { directory, systemIds: ["site", "settings"], primary: "gtmmatters" };

test("official, system and primary apps are trusted", () => {
  assert.equal(isOfficialApp("projects", trust), true);
  assert.equal(isOfficialApp("docs", trust), true);
  assert.equal(isOfficialApp("site", trust), true);
  assert.equal(isOfficialApp("gtmmatters", trust), true);
  assert.equal(isOfficialApp("hello", trust), false);
  assert.equal(isOfficialApp("acme", trust), false);
  assert.equal(isOfficialApp("acme", {}), false);
});

test("a community app cannot take another app's pages", () => {
  const warnings: string[] = [];
  const projects = { id: "projects", icon: "projects", Home: () => null, routes: [{ path: "/p/:id/:view?" }] };
  const evil = {
    id: "evil",
    icon: "x",
    home: "/",
    routes: [{ pattern: /^\/p\/([^/]+)/ }, { path: "/p/:id" }, { path: "/a/evil/item/:id" }, { pattern: /^\/a\/evil\/raw\/(\d+)$/ }],
    publicRoutes: { "/colophon": 1, "/a/evil/share": 2 },
    ownsPath: () => true
  };
  const site = { id: "site", publicRoutes: { "/colophon": 3 } };
  const [p, e, s] = guardApps([projects, evil, site], trust, (m) => warnings.push(m));

  // Official and system apps pass unchanged.
  assert.equal(p, projects);
  assert.equal(s, site);

  // The named path outside /a/evil/ is gone. The RegExp only matches inside /a/evil/.
  assert.equal(e.routes!.length, 3);
  assert.equal(e.routes!.some((r) => matchRoute(r, "/p/abc")), false);
  assert.deepEqual(matchRoute(e.routes![1], "/a/evil/item/7")?.params, { id: "7" });
  assert.equal(matchRoute(e.routes![2], "/a/evil/raw/5")?.match[1], "5");
  assert.deepEqual(e.publicRoutes, { "/a/evil/share": 2 });
  assert.equal(e.home, undefined);
  assert.equal(e.ownsPath!("/p/abc"), false);
  assert.equal(e.ownsPath!("/a/evil/item/7"), true);

  // Projects still owns its pages in the rail.
  assert.equal(activeApp([p, e, s], "/p/abc/board")?.id, "projects");
  assert.equal(appHome(e, [p, e, s]), "/a/evil");

  // One warning for each problem, naming the app and the route. A RegExp that starts in the space gives none.
  assert.equal(warnings.length, 4);
  assert.ok(warnings.every((w) => w.includes('"evil"')));
  assert.ok(warnings.some((w) => w.includes("/p/:id")));
  assert.equal(warnings.some((w) => w.includes("raw")), false);

  // The same problem is not logged again.
  guardApps([evil], trust, (m) => warnings.push(m));
  assert.equal(warnings.length, 4);
});

test("an app id that starts like another does not share its space", () => {
  assert.equal(inAppSpace("evil", "/a/evil"), true);
  assert.equal(inAppSpace("evil", "/a/evil/x"), true);
  assert.equal(inAppSpace("evil", "/a/evilx"), false);
  const [e] = guardApps([{ id: "ev", routes: [{ pattern: /^\/a\/ev/ }] }], trust, () => {});
  assert.equal(matchRoute(e.routes![0], "/a/evil/x"), null);
  assert.ok(matchRoute(e.routes![0], "/a/ev/x"));
});

test("a bad named path never matches, and does not throw", () => {
  assert.equal(matchRoute({ path: "/a/x/:id?/y" }, "/a/x/1/y"), null);
});
