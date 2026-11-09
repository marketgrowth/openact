import { test } from "node:test";
import assert from "node:assert/strict";
import {
  X402_NETWORKS,
  centsToUsdcUnits,
  decodeHeader,
  encodeHeader,
  formatUsd,
  parseUsd,
  paymentProblem,
  paymentRequirements,
  transferTypedData
} from "../src/shared/contribute.ts";

const PAY_TO = "0x1111111111111111111111111111111111111111";
const FROM = "0x2222222222222222222222222222222222222222";
const base = X402_NETWORKS["eip155:8453"];

test("amounts: dollars to cents, with limits", () => {
  assert.deepEqual(parseUsd("25"), { cents: 2500 });
  assert.deepEqual(parseUsd("$12.5"), { cents: 1250 });
  assert.deepEqual(parseUsd(" 12.05 "), { cents: 1205 });
  assert.deepEqual(parseUsd(100), { cents: 10000 });
  assert.ok("error" in parseUsd("0.99"));
  assert.ok("error" in parseUsd("10000.01"));
  assert.ok("error" in parseUsd("1.234"));
  assert.ok("error" in parseUsd("-5"));
  assert.ok("error" in parseUsd("1e3"));
  assert.ok("error" in parseUsd(""));
  assert.ok("error" in parseUsd(null));
});

test("formats dollars", () => {
  assert.equal(formatUsd(2500), "$25");
  assert.equal(formatUsd(1250), "$12.50");
  assert.equal(formatUsd(1000000), "$10,000");
});

test("USDC uses 6 decimals", () => {
  assert.equal(centsToUsdcUnits(1), "10000");
  assert.equal(centsToUsdcUnits(2500), "25000000");
});

test("payment requirements follow x402 v2 exact on EVM", () => {
  const req = paymentRequirements(base, PAY_TO, 500);
  assert.deepEqual(req, {
    scheme: "exact",
    network: "eip155:8453",
    amount: "5000000",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra: { assetTransferMethod: "eip-3009", name: "USD Coin", version: "2" }
  });
});

function payment(overrides: Record<string, unknown> = {}, auth: Record<string, unknown> = {}) {
  const req = paymentRequirements(base, PAY_TO, 500);
  return {
    x402Version: 2,
    accepted: req,
    payload: {
      signature: "0xabc",
      authorization: { from: FROM, to: PAY_TO, value: req.amount, validAfter: "0", validBefore: "9999999999", nonce: "0x01", ...auth }
    },
    ...overrides
  };
}

test("a payment must match the offered terms", () => {
  const req = paymentRequirements(base, PAY_TO, 500);
  assert.equal(paymentProblem(payment(), req), null);
  // Address case does not matter.
  assert.equal(paymentProblem(payment({}, { to: PAY_TO.toUpperCase().replace("0X", "0x") }), req), null);
  assert.match(paymentProblem(payment({ x402Version: 1 }), req)!, /version 2/);
  assert.match(paymentProblem(payment({ accepted: { ...req, amount: "1" } }), req)!, /terms/);
  assert.match(paymentProblem(payment({ accepted: { ...req, network: "eip155:84532" } }), req)!, /terms/);
  assert.match(paymentProblem(payment({ accepted: { ...req, payTo: FROM } }), req)!, /terms/);
  assert.match(paymentProblem(payment({}, { to: FROM }), req)!, /wrong address/);
  assert.match(paymentProblem(payment({}, { value: "1" }), req)!, /amount/);
  assert.match(paymentProblem(payment({}, { from: "nope" }), req)!, /payer/);
  assert.match(paymentProblem({ x402Version: 2, accepted: req }, req)!, /signed/);
  assert.match(paymentProblem(null, req)!, /JSON/);
});

test("headers round-trip as base64 JSON", () => {
  const value = { x402Version: 2, note: "Lyra Music Foundation ♪" };
  assert.deepEqual(decodeHeader(encodeHeader(value)), value);
  assert.equal(decodeHeader("not base64 json"), null);
});

test("typed data uses the USDC domain of the network", () => {
  const sepolia = X402_NETWORKS["eip155:84532"];
  const auth = { from: FROM, to: PAY_TO, value: "10000", validAfter: "0", validBefore: "1", nonce: "0x01" };
  const td = transferTypedData(sepolia, auth);
  assert.deepEqual(td.domain, { name: "USDC", version: "2", chainId: 84532, verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" });
  assert.equal(td.primaryType, "TransferWithAuthorization");
  assert.deepEqual(td.message, auth);
});
