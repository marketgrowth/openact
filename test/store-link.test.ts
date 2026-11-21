import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDeploy } from "./harness/deploy.ts";

/*
 * The store link (docs/plans.md, "How the store link works").
 * A stand-in store reads the site's link proof the way on.openact.ing does, then links the key.
 */

const STORE = "https://store.test";

function withStore(d: ReturnType<typeof makeDeploy>, answer: (body: Record<string, unknown>, proof: string | null) => Record<string, unknown>) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.origin !== STORE) return real(input, init);
    const path = url.pathname.replace("/api/apps/licenses/store", "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ path, body });
    if (path === "/link") {
      // The store reads the proof on the site's host. Here the site is the test deploy.
      const r = await d.call(null, "GET", "/api/site/director/link-proof");
      const proof = r.status === 200 ? String(r.json?.linkCode) : null;
      return Response.json(answer(body, proof));
    }
    if (path === "/claim") return Response.json({ status: "active", plan: "director", license: null, expiresAt: null });
    if (path === "/repos") return Response.json({ repos: [] });
    return Response.json({ error: "not here" }, { status: 404 });
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = real) };
}

const vars = { OPENACT_LICENSE: "oa1.e30.c2ln", SUPER_ADMIN_EMAILS: "root@deploy.test", OPENACT_STORE_URL: STORE };

test("a site with a hand-issued key links itself, and the store can confirm the link code", async () => {
  const d = makeDeploy(vars);
  const root = d.person("root@deploy.test");
  assert.equal((await d.call(null, "GET", "/api/site/director/link-proof")).status, 404, "no proof before a link");
  const store = withStore(d, (body, proof) => {
    assert.equal(body.license, vars.OPENACT_LICENSE);
    assert.equal(body.host, "deploy.test");
    assert.match(String(body.linkCode), /^[0-9a-f]{64}$/);
    assert.equal(proof, body.linkCode, "the proof page shows the code the site sent");
    assert.equal(body.claim, undefined, "the token itself never goes in a link request");
    return { status: "active" };
  });
  try {
    const r = await d.call(root, "POST", "/api/site/director/link");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json?.link, "active");
    assert.equal((r.json?.director as { storeOrder: boolean }).storeOrder, true);
    const first = store.calls.find((c) => c.path === "/link")!.body.linkCode;
    // Linking again keeps the same token.
    await d.call(root, "POST", "/api/site/director/link");
    assert.equal(store.calls.filter((c) => c.path === "/link").at(-1)!.body.linkCode, first);
    // The proof shows the hash, not the token.
    const proof = await d.call(null, "GET", "/api/site/director/link-proof");
    assert.equal(proof.json?.linkCode, first);
    assert.doesNotMatch(proof.text, /claim/);
  } finally {
    store.restore();
  }
});

test("store calls link the site first, then send the claim token", async () => {
  const d = makeDeploy(vars);
  const root = d.person("root@deploy.test");
  const store = withStore(d, () => ({ status: "active" }));
  try {
    const r = await d.call(root, "GET", "/api/site/director/repos");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(
      store.calls.map((c) => c.path),
      ["/link", "/repos"]
    );
    assert.match(String(store.calls[1]!.body.claim), /^[A-Za-z0-9_-]{43}$/);
  } finally {
    store.restore();
  }
});

test("only super admins can start a link", async () => {
  const d = makeDeploy(vars);
  const someone = d.person("someone@deploy.test");
  assert.equal((await d.call(someone, "POST", "/api/site/director/link")).status, 403);
});

test("a store without links does not block store calls", async () => {
  const d = makeDeploy(vars);
  const root = d.person("root@deploy.test");
  const real = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname.replace("/api/apps/licenses/store", "");
    paths.push(path);
    return path === "/repos" ? Response.json({ repos: [] }) : Response.json({ error: "This API route does not exist." }, { status: 404 });
  }) as typeof fetch;
  try {
    const r = await d.call(root, "GET", "/api/site/director/repos");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(paths, ["/link", "/repos"]);
  } finally {
    globalThis.fetch = real;
  }
});
