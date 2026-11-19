import { test } from "node:test";
import assert from "node:assert/strict";
import { deployHost, hostApp } from "../packages/core/src/server/hosts.ts";
import type { ServerApp } from "../packages/core/src/server/apps.ts";
import type { Env } from "../packages/core/src/server/env.ts";

const env = (appUrl: string) => ({ APP_URL: appUrl }) as unknown as Env;
const page = (hosts: string[]): ServerApp => ({
  id: "pages",
  name: "Pages",
  hosts: { owns: async (_e, h) => hosts.includes(h), fetch: async () => new Response("page") }
});

test("the deploy host comes from APP_URL", () => {
  assert.equal(deployHost(env("https://App.GTMMatters.com/")), "app.gtmmatters.com");
  assert.equal(deployHost(env("")), null);
  assert.equal(deployHost(env("not a url")), null);
});

test("an app that owns a hostname gets the request", async () => {
  const a = page(["gtmmatters.com"]);
  assert.equal(await hostApp([a], env("https://app.gtmmatters.com"), "GTMMatters.com"), a);
  assert.equal(await hostApp([a], env("https://app.gtmmatters.com"), "other.com"), null);
});

test("the deploy's own host never goes to an app, even if the app says it owns it", async () => {
  const greedy = page(["app.gtmmatters.com"]);
  assert.equal(await hostApp([greedy], env("https://app.gtmmatters.com"), "app.gtmmatters.com"), null);
});

test("an app whose check fails does not own the host, and the next app is asked", async () => {
  const broken: ServerApp = { id: "broken", name: "Broken", hosts: { owns: async () => Promise.reject(new Error("no table")), fetch: async () => new Response("") } };
  const a = page(["gtmmatters.com"]);
  assert.equal(await hostApp([broken, a], env("https://app.gtmmatters.com"), "gtmmatters.com"), a);
  assert.equal(await hostApp([broken], env(""), "gtmmatters.com"), null);
});

test("apps without hosts are skipped", async () => {
  assert.equal(await hostApp([{ id: "projects", name: "Projects" }], env(""), "gtmmatters.com"), null);
});
