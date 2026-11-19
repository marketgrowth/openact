import { test } from "node:test";
import assert from "node:assert/strict";
import { activeApp, appHome, appOwnsPath, homeAppAt, railApps, railGroups, railOrder, resolveAppPath } from "../packages/ui/src/app-paths.ts";

const projects = { id: "projects", icon: "projects", Home: () => null, routes: [{ pattern: /^\/p\/([^/]+)/ }] };
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

// A deploy where another app, such as Plant care, owns the home page.
const plants = { id: "plants", icon: "leaf", Home: () => null };
const hosted = [plants, projects, orbytt];

test("an app with a home page moves to /a/<id> when another app owns /", () => {
  assert.equal(appHome(plants, hosted), "/");
  assert.equal(appHome(projects, hosted), "/a/projects");
  assert.equal(homeAppAt(hosted, "/a/projects")?.id, "projects");
  assert.equal(homeAppAt(hosted, "/a/projects/")?.id, "projects");
  assert.equal(homeAppAt(hosted, "/a/orbytt"), undefined);
});

test("the app that owns / keeps it, and the other app keeps its own paths", () => {
  assert.equal(activeApp(hosted, "/")?.id, "plants");
  assert.equal(activeApp(hosted, "/a/projects")?.id, "projects");
  assert.equal(activeApp(hosted, "/p/abc/board")?.id, "projects");
});

test("a link to /a/<id> goes to the app's home", () => {
  assert.equal(resolveAppPath(projects, apps, "/a/projects"), "/");
  assert.equal(resolveAppPath(projects, hosted, "/a/projects"), "/a/projects");
  assert.equal(resolveAppPath(projects, hosted, "/p/abc"), "/p/abc");
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

// An app with railPlacement "end", such as Pages, sits in its own group at the end of the app list.
const pages = { id: "pages", Mark: () => null, home: "/a/pages", railPlacement: "end" as const };
const withEnd = [projects, pages, orbytt, hello, site];

test("apps with railPlacement end go last, in their own group", () => {
  const g = railGroups(withEnd, null);
  assert.deepEqual(g.others.map((a) => a.id), ["projects", "orbytt", "hello"]);
  assert.deepEqual(g.end.map((a) => a.id), ["pages"]);
  assert.deepEqual(railOrder(withEnd).map((a) => a.id), ["projects", "orbytt", "hello", "pages"]);
  assert.deepEqual(railGroups(apps, null).end, []);
});

test("the primary app stays first, even with railPlacement end", () => {
  const g = railGroups(withEnd, "pages");
  assert.equal(g.primary?.id, "pages");
  assert.deepEqual(g.end, []);
  assert.deepEqual(railOrder(withEnd, "hello").map((a) => a.id), ["hello", "projects", "orbytt", "pages"]);
});

test("an end app owns its own paths", () => {
  assert.equal(activeApp(withEnd, "/a/pages")?.id, "pages");
  assert.equal(activeApp(withEnd, "/")?.id, "projects");
});

test("footer apps sit apart from the other apps, after them in rail order", () => {
  const advisory = { id: "advisory", icon: "handshake", home: "/a/advisory", railPlacement: "footer" as const };
  const all = [projects, advisory, orbytt];
  const g = railGroups(all, null);
  assert.deepEqual(g.others.map((a) => a.id), ["projects", "orbytt"]);
  assert.deepEqual(g.footer.map((a) => a.id), ["advisory"]);
  assert.deepEqual(railOrder(all).map((a) => a.id), ["projects", "orbytt", "advisory"]);
  assert.equal(activeApp(all, "/a/advisory/me")?.id, "advisory");
  // A primary app stays at the top, even with a footer placement.
  assert.equal(railGroups(all, "advisory").primary?.id, "advisory");
  assert.deepEqual(railGroups(all, "advisory").footer, []);
  // End apps come before footer apps.
  assert.deepEqual(railOrder([projects, advisory, pages]).map((a) => a.id), ["projects", "pages", "advisory"]);
});
