import { test } from "node:test";
import assert from "node:assert/strict";
import { activeApp, appHome, appOwnsPath, railApps, railGroups, railOrder } from "../packages/ui/src/app-paths.ts";

const projects = { id: "projects", icon: "projects", Home: () => null, routes: [{ pattern: /^\/p\/([^/]+)/ }], ownsPath: (p: string) => p === "/" || p.startsWith("/p/") };
const orbytt = { id: "orbytt", Mark: () => null, routes: [{ pattern: /^\/a\/orbytt\/talent$/ }] };
const hello = { id: "hello", icon: "chat", home: "/hello", routes: [{ pattern: /^\/hello\/?$/ }] };
const site = { id: "site" };
const apps = [projects, orbytt, hello, site];

test("only apps with an icon or a mark show in the rail", () => {
  assert.deepEqual(railApps(apps).map((a) => a.id), ["projects", "orbytt", "hello"]);
});

test("each app has a home", () => {
  assert.equal(appHome(projects, apps), "/");
  assert.equal(appHome(orbytt, apps), "/a/orbytt");
  assert.equal(appHome(hello, apps), "/hello");
});

test("a path picks the app that owns it", () => {
  assert.equal(activeApp(apps, "/")?.id, "projects");
  assert.equal(activeApp(apps, "/p/abc/timeline")?.id, "projects");
  assert.equal(activeApp(apps, "/a/orbytt")?.id, "orbytt");
  assert.equal(activeApp(apps, "/a/orbytt/contractors")?.id, "orbytt");
  assert.equal(activeApp(apps, "/hello")?.id, "hello");
});

test("a path that no app owns shows the first rail app", () => {
  assert.equal(activeApp(apps, "/nowhere")?.id, "projects");
  assert.equal(appOwnsPath(orbytt, apps, "/a/orbytter"), false);
});

test("without a primary app, the rail keeps install order", () => {
  const g = railGroups(apps, null);
  assert.equal(g.primary, undefined);
  assert.deepEqual(g.others.map((a) => a.id), ["projects", "orbytt", "hello"]);
  assert.deepEqual(railOrder(apps).map((a) => a.id), ["projects", "orbytt", "hello"]);
});

test("the primary app goes first, on its own", () => {
  const g = railGroups(apps, "hello");
  assert.equal(g.primary?.id, "hello");
  assert.deepEqual(g.others.map((a) => a.id), ["projects", "orbytt"]);
  assert.deepEqual(railOrder(apps, "hello").map((a) => a.id), ["hello", "projects", "orbytt"]);
});

test("a primary app that is off or has no rail icon is ignored", () => {
  assert.equal(railGroups(apps, "site").primary, undefined);
  assert.equal(railGroups(apps, "missing").primary, undefined);
  assert.deepEqual(railOrder(apps, "missing").map((a) => a.id), ["projects", "orbytt", "hello"]);
});

test("the primary app does not change which app owns a path", () => {
  assert.equal(activeApp(apps, "/")?.id, "projects");
  assert.equal(appHome(projects, apps), "/");
});
