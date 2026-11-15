import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEGAL_URL_MAX,
  SITE_NAME_MAX,
  cleanLegalUrl,
  cleanSignInText,
  cleanSiteName,
  isSuperAdminEmail,
  parseEmailList,
  signInBackgroundUrl,
  siteLogoUrl
} from "../packages/core/src/shared/site.ts";

test("the super admin list accepts commas, spaces and any case", () => {
  assert.deepEqual(parseEmailList(" Victor@Example.com, ops@example.com;\nthird@example.org "), [
    "victor@example.com",
    "ops@example.com",
    "third@example.org"
  ]);
  assert.deepEqual(parseEmailList(""), []);
  assert.deepEqual(parseEmailList(undefined), []);
});

test("only listed emails are super admins", () => {
  const list = "victor@example.com, ops@example.com";
  assert.equal(isSuperAdminEmail(list, "VICTOR@example.com"), true);
  assert.equal(isSuperAdminEmail(list, "someone@example.com"), false);
  assert.equal(isSuperAdminEmail("", "victor@example.com"), false);
  assert.equal(isSuperAdminEmail(undefined, "victor@example.com"), false);
  assert.equal(isSuperAdminEmail(list, ""), false);
});

test("a part of an email is not a match", () => {
  assert.equal(isSuperAdminEmail("victor@example.com", "ctor@example.com"), false);
  assert.equal(isSuperAdminEmail("victor@example.com", "victor@example.co"), false);
});

test("the app name is one clean line with a length limit", () => {
  assert.deepEqual(cleanSiteName("  Acme   Work\n"), { name: "Acme Work" });
  assert.deepEqual(cleanSiteName(""), { name: "" });
  assert.deepEqual(cleanSiteName(null), { name: "" });
  assert.ok("problem" in cleanSiteName(42));
  assert.ok("problem" in cleanSiteName("x".repeat(SITE_NAME_MAX + 1)));
  assert.deepEqual(cleanSiteName("x".repeat(SITE_NAME_MAX)), { name: "x".repeat(SITE_NAME_MAX) });
});

test("the logo URL changes with each upload", () => {
  assert.notEqual(siteLogoUrl("2026-11-08T07:00:00.000Z"), siteLogoUrl("2026-11-08T07:05:00.000Z"));
  assert.match(siteLogoUrl("2026-11-08T07:00:00.000Z"), /^\/api\/site\/logo\?v=/);
});

test("sign-in text is one clean line with a length limit", () => {
  assert.deepEqual(cleanSignInText("  Plan the\nwork.  ", "Heading", 20), { text: "Plan the work." });
  assert.deepEqual(cleanSignInText(undefined, "Heading", 20), { text: "" });
  assert.ok("problem" in cleanSignInText("x".repeat(21), "Heading", 20));
  assert.ok("problem" in cleanSignInText(42, "Credit", 20));
});

test("legal links must be full http or https links", () => {
  assert.deepEqual(cleanLegalUrl(" https://example.com/terms ", "Terms of Use"), { url: "https://example.com/terms" });
  assert.deepEqual(cleanLegalUrl("http://example.com/privacy", "Privacy Policy"), { url: "http://example.com/privacy" });
  assert.deepEqual(cleanLegalUrl("", "Terms of Use"), { url: "" });
  assert.deepEqual(cleanLegalUrl(null, "Terms of Use"), { url: "" });
  assert.ok("problem" in cleanLegalUrl("javascript:alert(1)", "Terms of Use"));
  assert.ok("problem" in cleanLegalUrl("data:text/html,hi", "Terms of Use"));
  assert.ok("problem" in cleanLegalUrl("/terms", "Terms of Use"));
  assert.ok("problem" in cleanLegalUrl("https://example.com/" + "a".repeat(LEGAL_URL_MAX), "Terms of Use"));
});

test("the sign-in background URL changes with each upload", () => {
  assert.equal(signInBackgroundUrl("2026-11-14T00:00:00.000Z"), "/api/site/sign-in-background?v=2026-11-14T00%3A00%3A00.000Z");
});
