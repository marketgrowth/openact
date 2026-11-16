import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  applicationFee,
  bpsToPercent,
  checkoutForm,
  cleanLabel,
  engagementProjectName,
  engagementStatusFor,
  feeProblem,
  formatMoney,
  formatPrice,
  parsePriceInput,
  percentToBps,
  priceProblem,
  readSettings,
  sniffPhoto,
  STRIPE_SOURCE,
  type CheckoutInput
} from "../apps/advisory/src/shared/rules.ts";

test("fees convert between percent and basis points without drift", () => {
  assert.equal(percentToBps(15), 1500);
  assert.equal(percentToBps(12.5), 1250);
  assert.equal(percentToBps(0.01), 1);
  assert.equal(bpsToPercent(1250), 12.5);
  assert.equal(bpsToPercent(percentToBps(7.35)), 7.35);
});

test("a fee must be a number from 0 to 50 with at most two decimals", () => {
  assert.equal(feeProblem(0), null);
  assert.equal(feeProblem(15), null);
  assert.equal(feeProblem(50), null);
  assert.equal(feeProblem(12.75), null);
  assert.match(feeProblem(-1)!, /from 0 to 50/);
  assert.match(feeProblem(50.01)!, /from 0 to 50/);
  assert.match(feeProblem(12.345)!, /two decimal/);
  assert.match(feeProblem("15")!, /number/);
  assert.match(feeProblem(Number.NaN)!, /number/);
});

test("the application fee rounds to the nearest cent and never passes the amount", () => {
  assert.equal(applicationFee(50000, 1500), 7500);
  assert.equal(applicationFee(999, 1250), 125); // 124.875
  assert.equal(applicationFee(101, 1500), 15); // 15.15
  assert.equal(applicationFee(10000, 0), 0);
  assert.equal(applicationFee(0, 1500), 0);
  assert.equal(applicationFee(100, 20000), 100);
});

test("prices are whole cents from 1.00 to 100,000.00", () => {
  assert.equal(priceProblem(100), null);
  assert.equal(priceProblem(10_000_000), null);
  assert.match(priceProblem(99)!, /at least 1.00/);
  assert.match(priceProblem(10_000_001)!, /too high/);
  assert.match(priceProblem(12.5)!, /whole number/);
  assert.match(priceProblem("500")!, /whole number/);
});

test("typed prices become cents", () => {
  assert.equal(parsePriceInput("500"), 50000);
  assert.equal(parsePriceInput("1,200.5"), 120050);
  assert.equal(parsePriceInput("$ 99.99"), 9999);
  assert.equal(parsePriceInput("12.345"), null);
  assert.equal(parsePriceInput("abc"), null);
  assert.equal(parsePriceInput(""), null);
});

test("money and prices format for people", () => {
  assert.equal(formatMoney({ amount: 120000, currency: "usd" }), "$1,200");
  assert.equal(formatMoney({ amount: 120050, currency: "usd" }), "$1,200.50");
  assert.equal(formatPrice({ amount: 200000, currency: "usd" }, "retainer"), "$2,000 a month");
  assert.equal(formatPrice({ amount: 50000, currency: "usd" }, "one_time"), "$500");
  assert.match(formatMoney({ amount: 5000, currency: "php" }), /50/);
});

test("settings fall back to the defaults and clean the labels", () => {
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
  const s = readSettings({ label: "  Coach ", label_plural: "", approval_mode: "auto", default_fee_bps: 1250, currency: "php" });
  assert.equal(s.label, "Coach");
  assert.equal(s.labelPlural, "Advisors");
  assert.equal(s.approvalMode, "auto");
  assert.equal(s.defaultFeePercent, 12.5);
  assert.equal(s.currency, "php");
  assert.equal(readSettings({ approval_mode: "weird", currency: "xyz" }).approvalMode, "required");
  assert.equal(readSettings({ currency: "xyz" }).currency, "usd");
  assert.equal(cleanLabel("x".repeat(50), "Advisor").length, 30);
  assert.equal(cleanLabel(42, "Advisor"), "Advisor");
});

test("engagement project names include the client and the offer, and fit 80 characters", () => {
  assert.equal(engagementProjectName("Acme Inc", "Growth retainer"), "Acme Inc: Growth retainer");
  assert.equal(engagementProjectName("  ", " "), "Client: Engagement");
  const long = engagementProjectName("A".repeat(60), "B".repeat(60));
  assert.equal(long.length, 80);
  assert.ok(long.endsWith("…"));
});

test("retainers stay active while Stripe retries the card", () => {
  assert.equal(engagementStatusFor("active"), "active");
  assert.equal(engagementStatusFor("trialing"), "active");
  assert.equal(engagementStatusFor("past_due"), "active");
  assert.equal(engagementStatusFor("canceled"), "ended");
  assert.equal(engagementStatusFor("unpaid"), "ended");
  assert.equal(engagementStatusFor("incomplete_expired"), "ended");
});

const base: CheckoutInput = {
  requestId: "req_1",
  companyId: "co_1",
  advisorId: "adv_1",
  terms: { name: "Strategy session", price: { amount: 50000, currency: "usd" }, kind: "one_time" },
  feeBps: 1500,
  destination: "acct_123",
  customerEmail: "client@example.com",
  successUrl: "https://app.example.com/a/advisory/pay/req_1?checkout=done&session_id={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://app.example.com/a/advisory/pay/req_1",
  site: "app.example.com"
};

test("a one-time offer makes a payment-mode destination charge with a fixed fee", () => {
  const f = checkoutForm(base);
  assert.equal(f.get("mode"), "payment");
  assert.equal(f.get("line_items[0][price_data][unit_amount]"), "50000");
  assert.equal(f.get("line_items[0][price_data][currency]"), "usd");
  assert.equal(f.get("line_items[0][price_data][recurring][interval]"), null);
  assert.equal(f.get("payment_intent_data[transfer_data][destination]"), "acct_123");
  assert.equal(f.get("payment_intent_data[application_fee_amount]"), "7500");
  assert.equal(f.get("subscription_data[application_fee_percent]"), null);
  assert.equal(f.get("metadata[source]"), STRIPE_SOURCE);
  assert.equal(f.get("metadata[request_id]"), "req_1");
  assert.equal(f.get("payment_intent_data[metadata][company_id]"), "co_1");
  assert.equal(f.get("client_reference_id"), "req_1");
  assert.ok(f.get("success_url")!.includes("{CHECKOUT_SESSION_ID}"));
});

test("a retainer makes a monthly subscription with a fee percent", () => {
  const f = checkoutForm({ ...base, feeBps: 1250, terms: { ...base.terms, kind: "retainer" } });
  assert.equal(f.get("mode"), "subscription");
  assert.equal(f.get("line_items[0][price_data][recurring][interval]"), "month");
  assert.equal(f.get("subscription_data[transfer_data][destination]"), "acct_123");
  assert.equal(f.get("subscription_data[application_fee_percent]"), "12.5");
  assert.equal(f.get("subscription_data[metadata][source]"), STRIPE_SOURCE);
  assert.equal(f.get("subscription_data[metadata][request_id]"), "req_1");
  assert.equal(f.get("payment_intent_data[application_fee_amount]"), null);
});

test("a zero fee sends no application fee", () => {
  assert.equal(checkoutForm({ ...base, feeBps: 0 }).get("payment_intent_data[application_fee_amount]"), null);
  assert.equal(checkoutForm({ ...base, feeBps: 0, terms: { ...base.terms, kind: "retainer" } }).get("subscription_data[application_fee_percent]"), null);
});

test("profile photos must be PNG, JPEG or WebP by their bytes", () => {
  assert.equal(sniffPhoto(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffPhoto(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
  assert.equal(sniffPhoto(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(sniffPhoto(new Uint8Array([])), null);
});
