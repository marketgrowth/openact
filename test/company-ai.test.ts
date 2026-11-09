import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPANY_AI_MODELS, aiModelLabel, cleanApiKey, isCompanyAiModel, isCompanyAiProvider, keyHintOf } from "../packages/core/src/shared/ai.ts";
import { openKey, sealKey } from "../packages/core/src/server/secret-box.ts";

const SECRET = "a-test-secret-that-is-long-enough";
const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz-1234";

test("a sealed key opens with the same secret and company", async () => {
  const sealed = await sealKey(SECRET, "company-a", KEY);
  assert.ok(sealed.startsWith("v1."));
  assert.ok(!sealed.includes(KEY));
  assert.equal(await openKey(SECRET, "company-a", sealed), KEY);
});

test("each seal is different, because the IV is random", async () => {
  assert.notEqual(await sealKey(SECRET, "company-a", KEY), await sealKey(SECRET, "company-a", KEY));
});

test("a sealed key does not open for another company", async () => {
  const sealed = await sealKey(SECRET, "company-a", KEY);
  assert.equal(await openKey(SECRET, "company-b", sealed), null);
});

test("a sealed key does not open after the secret changes", async () => {
  const sealed = await sealKey(SECRET, "company-a", KEY);
  assert.equal(await openKey("another-secret-that-is-long-enough", "company-a", sealed), null);
});

test("damaged or unknown data does not open", async () => {
  const sealed = await sealKey(SECRET, "company-a", KEY);
  const flipped = sealed.slice(0, -4) + (sealed.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.equal(await openKey(SECRET, "company-a", flipped), null);
  assert.equal(await openKey(SECRET, "company-a", "v2.abc"), null);
  assert.equal(await openKey(SECRET, "company-a", "v1.not base64!"), null);
});

test("only known providers and their models are accepted", () => {
  assert.equal(isCompanyAiProvider("anthropic"), true);
  assert.equal(isCompanyAiProvider("openai"), false);
  assert.equal(isCompanyAiProvider("default"), false);
  assert.equal(isCompanyAiModel("anthropic", "claude-sonnet-5-5"), true);
  assert.equal(isCompanyAiModel("anthropic", "gpt-4.1-mini"), false);
  assert.equal(COMPANY_AI_MODELS.anthropic[0].id, "claude-sonnet-5-5");
});

test("Anthropic keys are checked for shape before any request", () => {
  assert.deepEqual(cleanApiKey("anthropic", `  ${KEY}\n`), { key: KEY });
  assert.ok("problem" in cleanApiKey("anthropic", ""));
  assert.ok("problem" in cleanApiKey("anthropic", 42));
  assert.ok("problem" in cleanApiKey("anthropic", "sk-proj-123"));
  assert.ok("problem" in cleanApiKey("anthropic", "sk-ant-has space"));
  assert.ok("problem" in cleanApiKey("anthropic", "sk-ant-" + "x".repeat(400)));
});

test("labels and hints", () => {
  assert.equal(aiModelLabel("claude-sonnet-5-5"), "Claude Sonnet 5.5");
  assert.equal(aiModelLabel("@cf/meta/llama-3.3-70b-instruct-fp8-fast"), "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.equal(keyHintOf(KEY), "1234");
});
