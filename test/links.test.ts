import { test } from "node:test";
import assert from "node:assert/strict";
import { findLinks, linkLabel, safeHref, splitLinks } from "../packages/ui/src/links.ts";

test("finds http, https and www addresses in text", () => {
  const s = splitLinks("Notice: https://castingnetworks.com/role/123 and www.backstage.com/x. Done");
  assert.deepEqual(
    s.filter((x) => x.kind === "link").map((x) => x.kind === "link" && x.href),
    ["https://castingnetworks.com/role/123", "https://www.backstage.com/x"]
  );
  assert.equal(s.map((x) => x.text).join(""), "Notice: https://castingnetworks.com/role/123 and www.backstage.com/x. Done");
});

test("drops sentence punctuation and unmatched brackets at the end", () => {
  assert.equal(findLinks("(see https://example.com/a).")[0].href, "https://example.com/a");
  assert.equal(findLinks("https://en.wikipedia.org/wiki/Foo_(bar)")[0].href, "https://en.wikipedia.org/wiki/Foo_(bar)");
});

test("never links unsafe schemes or bare hosts", () => {
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(findLinks("javascript:alert(1) data:text/html,x file:///etc/passwd").length, 0);
  assert.equal(safeHref("http://localhost"), null);
});

test("repeats are listed once and labels stay short", () => {
  assert.equal(findLinks("https://a.com/x https://a.com/x").length, 1);
  assert.equal(linkLabel("https://www.backstage.com/casting/role/123"), "backstage.com/casting/role/123");
  assert.ok(linkLabel("https://example.com/" + "a".repeat(100)).length <= 60);
});
