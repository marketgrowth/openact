import { test } from "node:test";
import assert from "node:assert/strict";
import { handleContribute, isContributeRoute } from "../landing/src/contribute.ts";
import { CONTRIBUTE_URL } from "../src/shared/contribute.ts";

const ORIGIN = "https://openact.ing";
const PAY_TO = "0x1111111111111111111111111111111111111111";

test("the Contribute page lives on openact.ing", () => {
  assert.equal(CONTRIBUTE_URL, "https://openact.ing/contribute");
  assert.equal(isContributeRoute("/api/contribute"), true);
  assert.equal(isContributeRoute("/api/contribute/x402"), true);
  assert.equal(isContributeRoute("/api/contributex"), false);
  assert.equal(isContributeRoute("/contribute"), false);
});

test("options show only the methods that are set up", async () => {
  const none = await (await handleContribute(new Request(`${ORIGIN}/api/contribute`), {})).json();
  assert.deepEqual(none, { card: false, cardTestMode: false, manageUrl: "", crypto: null });

  const res = await handleContribute(new Request(`${ORIGIN}/api/contribute`), {
    STRIPE_SECRET_KEY: "rk_test_abc",
    STRIPE_PORTAL_URL: "https://billing.stripe.com/p/login/x",
    X402_PAY_TO: PAY_TO
  });
  const o = await res.json();
  assert.equal(o.card, true);
  assert.equal(o.cardTestMode, true);
  assert.equal(o.manageUrl, "https://billing.stripe.com/p/login/x");
  assert.equal(o.crypto.network, "eip155:84532");
  assert.equal(o.crypto.endpoint, `${ORIGIN}/api/contribute/x402`);
  assert.equal(o.crypto.rpcUrl, "https://sepolia.base.org");
});

test("checkout refuses bad input before it calls Stripe", async () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    handleContribute(new Request(`${ORIGIN}/api/contribute/checkout`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }), {
      STRIPE_SECRET_KEY: "rk_test_abc"
    });
  assert.equal((await post({ amount: "25" }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await post({ amount: "0.5" })).status, 400);
  assert.equal((await post({ amount: "25", frequency: "weekly" })).status, 400);
  const off = await handleContribute(
    new Request(`${ORIGIN}/api/contribute/checkout`, { method: "POST", body: JSON.stringify({ amount: "25" }) }),
    {}
  );
  assert.equal(off.status, 404);
  assert.match((await off.json()).error, /not set up/);
});

test("the x402 endpoint answers 402 with terms", async () => {
  const res = await handleContribute(new Request(`${ORIGIN}/api/contribute/x402?amount=5`), { X402_PAY_TO: PAY_TO });
  assert.equal(res.status, 402);
  assert.ok(res.headers.get("PAYMENT-REQUIRED"));
  const body = await res.json();
  assert.equal(body.accepts[0].amount, "5000000");
  assert.equal(body.resource.url, `${ORIGIN}/api/contribute/x402?amount=5.00`);
  const off = await handleContribute(new Request(`${ORIGIN}/api/contribute/x402?amount=5`), {});
  assert.equal(off.status, 404);
});

test("an unknown contribution route is a 404", async () => {
  assert.equal((await handleContribute(new Request(`${ORIGIN}/api/contribute/nope`), {})).status, 404);
});
