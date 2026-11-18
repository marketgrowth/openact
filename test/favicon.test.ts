import { test } from "node:test";
import assert from "node:assert/strict";
import { setFavicon, type IconLink } from "../packages/ui/src/favicon.ts";

function link(attrs: Record<string, string>): IconLink & { attrs: Record<string, string> } {
  const a = { ...attrs };
  return {
    attrs: a,
    dataset: {},
    getAttribute: (n) => a[n] ?? null,
    setAttribute: (n, v) => void (a[n] = v),
    removeAttribute: (n) => void delete a[n]
  };
}

const page = () => [
  link({ rel: "icon", href: "/favicon.ico", sizes: "32x32" }),
  link({ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }),
  link({ rel: "apple-touch-icon", href: "/apple-touch-icon.png" })
];

test("the site logo replaces every icon, the SVG icon included", () => {
  const links = page();
  setFavicon("/api/site/logo?v=1", links);
  for (const l of links) {
    assert.equal(l.attrs.href, "/api/site/logo?v=1");
    assert.equal(l.attrs.type, undefined);
    assert.equal(l.attrs.sizes, undefined);
  }
});

test("removing the logo puts back the default icons", () => {
  const links = page();
  setFavicon("/api/site/logo?v=1", links);
  setFavicon("/api/site/logo?v=2", links);
  setFavicon(null, links);
  assert.deepEqual(
    links.map((l) => l.attrs),
    page().map((l) => l.attrs)
  );
});

test("no logo leaves the default icons as they are", () => {
  const links = page();
  setFavicon(null, links);
  assert.deepEqual(
    links.map((l) => l.attrs),
    page().map((l) => l.attrs)
  );
});
