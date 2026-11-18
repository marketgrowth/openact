import { test } from "node:test";
import assert from "node:assert/strict";
import { adminUrl, cleanSiteUrl } from "../apps/emdash/src/shared/rules.ts";

const ok = (raw: unknown) => {
  const r = cleanSiteUrl(raw);
  assert.ok("url" in r, `expected a url for ${String(raw)}`);
  return r.url;
};
const bad = (raw: unknown) => {
  const r = cleanSiteUrl(raw);
  assert.ok("problem" in r, `expected a problem for ${String(raw)}`);
  return r.problem;
};

test("a site address is kept as the site part, without a final slash", () => {
  assert.equal(ok("https://cms.example.com"), "https://cms.example.com");
  assert.equal(ok("https://cms.example.com/"), "https://cms.example.com");
  assert.equal(ok("  cms.example.com  "), "https://cms.example.com");
  assert.equal(ok("https://cms.example.com/?x=1#top"), "https://cms.example.com");
});

test("an admin address becomes the site address", () => {
  assert.equal(ok("https://cms.example.com/_emdash/admin/"), "https://cms.example.com");
  assert.equal(ok("https://cms.example.com/_emdash/admin/content/posts"), "https://cms.example.com");
  assert.equal(ok("https://example.com/blog/_emdash/admin"), "https://example.com/blog");
});

test("empty means no address", () => {
  assert.equal(ok(""), "");
  assert.equal(ok("   "), "");
  assert.equal(ok(null), "");
  assert.equal(ok(undefined), "");
});

test("only https, except http on this computer", () => {
  assert.match(bad("http://cms.example.com"), /https/);
  assert.match(bad("javascript:alert(1)"), /web address|https/);
  assert.match(bad("ftp://cms.example.com"), /https/);
  assert.equal(ok("http://localhost:4321"), "http://localhost:4321");
  assert.equal(ok("http://127.0.0.1:8787/_emdash/admin/"), "http://127.0.0.1:8787");
});

test("other bad addresses are refused", () => {
  assert.match(bad("https://user:pass@cms.example.com"), /user name/);
  assert.match(bad(42), /text/);
  assert.match(bad(`https://cms.example.com/${"a".repeat(400)}`), /too long/);
});

test("the admin lives at /_emdash/admin/", () => {
  assert.equal(adminUrl("https://cms.example.com"), "https://cms.example.com/_emdash/admin/");
  assert.equal(adminUrl("https://example.com/blog"), "https://example.com/blog/_emdash/admin/");
});
