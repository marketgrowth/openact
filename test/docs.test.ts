import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_DOC, ContentError, headingId, renderHtml, safeHref, sanitizeDoc, wordCount } from "../apps/docs/src/shared/content.ts";
import { pageBox, paginate, printCss } from "../apps/docs/src/shared/page.ts";
import { FILE_SRC, fileSrc, isShareToken, sniffImage } from "../apps/docs/src/shared/types.ts";
import { parseAppsOff } from "../packages/core/src/shared/site.ts";
import { cleanName, cleanTagNames, folderDepth, folderMoveProblem, folderPaths, isInside } from "../apps/docs/src/shared/library.ts";

const FILE_ID = "0b6d3c1e-4f2a-4d8e-9a1b-2c3d4e5f6a7b";
const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) => (marks ? { type: "text", text, marks } : { type: "text", text });

test("the cleaner keeps known nodes and drops unknown nodes, marks and attributes", () => {
  const out = sanitizeDoc(
    doc(
      { type: "heading", attrs: { level: 2, textAlign: "center", onclick: "x" }, content: [t("Goals")] },
      p(t("bold", [{ type: "bold" }, { type: "evil" }]), t(" plain")),
      { type: "script", content: [t("alert(1)")] },
      { type: "iframe", attrs: { src: "https://evil.example" } }
    )
  );
  assert.deepEqual(
    out,
    doc({ type: "heading", attrs: { level: 2, textAlign: "center" }, content: [t("Goals")] }, p(t("bold", [{ type: "bold" }]), t(" plain")))
  );
});

test("the cleaner refuses things that are not docs and docs that are too big", () => {
  assert.throws(() => sanitizeDoc(null), ContentError);
  assert.throws(() => sanitizeDoc({ type: "paragraph" }), ContentError);
  assert.throws(() => sanitizeDoc(doc(p(t("x".repeat(1_000_001))))), ContentError);
  let deep: unknown = p(t("deep"));
  for (let i = 0; i < 50; i++) deep = { type: "blockquote", content: [deep] };
  assert.throws(() => sanitizeDoc(doc(deep)), ContentError);
});

test("an empty doc becomes one empty paragraph", () => {
  assert.deepEqual(sanitizeDoc(doc()), EMPTY_DOC);
  assert.deepEqual(sanitizeDoc({ type: "doc" }), EMPTY_DOC);
});

test("links keep only web, email, phone and anchor targets", () => {
  assert.equal(safeHref("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(safeHref("mailto:ana@example.com"), "mailto:ana@example.com");
  assert.equal(safeHref("#h2-goals"), "#h2-goals");
  assert.equal(safeHref("javascript:alert(1)"), undefined);
  assert.equal(safeHref(" JaVaScRiPt:alert(1)"), undefined);
  assert.equal(safeHref("data:text/html,<b>x</b>"), undefined);
  assert.equal(safeHref("java\tscript:alert(1)"), undefined);
  const out = sanitizeDoc(doc(p(t("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))));
  assert.deepEqual(out, doc(p(t("x"))));
});

test("images must be files uploaded to Docs", () => {
  assert.ok(FILE_SRC.test(fileSrc(FILE_ID)));
  const out = sanitizeDoc(
    doc(
      { type: "image", attrs: { src: fileSrc(FILE_ID), alt: "Logo", width: 300, height: 100 } },
      { type: "image", attrs: { src: "https://tracker.example/pixel.gif" } }
    )
  );
  assert.deepEqual(out, doc({ type: "image", attrs: { src: fileSrc(FILE_ID), alt: "Logo", width: 300 } }));
});

test("page breaks stay at the top level only", () => {
  const out = sanitizeDoc(doc(p(t("a")), { type: "pageBreak" }, { type: "blockquote", content: [{ type: "pageBreak" }, p(t("b"))] }));
  assert.deepEqual(out, doc(p(t("a")), { type: "pageBreak" }, { type: "blockquote", content: [p(t("b"))] }));
});

test("blocks hold no text, and paragraphs hold no blocks", () => {
  const out = sanitizeDoc(doc(t("loose text"), p(p(t("nested"))), p(t("ok"))));
  assert.deepEqual(out, doc({ type: "paragraph" }, p(t("ok"))));
});

test("the renderer escapes text and attributes", () => {
  const clean = sanitizeDoc(
    doc(
      p(t('<script>alert("x")</script> & "quotes"')),
      { type: "image", attrs: { src: fileSrc(FILE_ID), alt: '"><img src=x onerror=alert(1)>' } },
      p(t("site", [{ type: "link", attrs: { href: "https://example.com/?a=1&b=<2>" } }]))
    )
  );
  const html = renderHtml(clean).blocks.join("");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;"));
  assert.ok(html.includes('alt="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"'));
  assert.ok(!/<img[^>]+onerror=/i.test(html.replace(/alt="[^"]*"/g, "")));
  assert.ok(html.includes('href="https://example.com/?a=1&amp;b=%3C2%3E"'));
  assert.ok(html.includes('rel="noopener noreferrer nofollow"'));
});

test("the renderer maps image paths for the share page and lists headings", () => {
  const clean = sanitizeDoc(
    doc(
      { type: "heading", attrs: { level: 1 }, content: [t("Project brief")] },
      { type: "image", attrs: { src: fileSrc(FILE_ID) } },
      { type: "pageBreak" },
      { type: "heading", attrs: { level: 2 }, content: [t("Budget & dates")] }
    )
  );
  const r = renderHtml(clean, { imageUrl: (src) => src.replace("/api/apps/docs/files/", "/docs/s/TOKEN/files/") });
  assert.equal(r.blocks.length, 4);
  assert.deepEqual(r.breaks, [2]);
  assert.ok(r.blocks[1]!.includes(`src="/docs/s/TOKEN/files/${FILE_ID}"`));
  assert.deepEqual(r.outline, [
    { id: "h1-project-brief", level: 1, text: "Project brief" },
    { id: "h2-budget-dates", level: 2, text: "Budget & dates" }
  ]);
  assert.ok(r.blocks[3]!.startsWith('<h2 id="h2-budget-dates">'));
  assert.equal(headingId(7, "  "), "h7");
});

test("tables, checklists and open-close sections render", () => {
  const clean = sanitizeDoc(
    doc(
      {
        type: "table",
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 2, colwidth: [120, 80] }, content: [p(t("Item"))] }] },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [p(t("A"))] },
              { type: "tableCell", content: [p(t("B"))] }
            ]
          }
        ]
      },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("Done"))] }] },
      {
        type: "details",
        attrs: { open: true },
        content: [
          { type: "detailsSummary", content: [t("More")] },
          { type: "detailsContent", content: [p(t("Hidden"))] }
        ]
      }
    )
  );
  const html = renderHtml(clean).blocks.join("");
  assert.ok(html.includes('<colgroup><col width="120"><col width="80"></colgroup>'));
  assert.ok(html.includes('<th colspan="2">'));
  assert.ok(html.includes('<li class="task done">'));
  assert.ok(html.includes("<details open><summary>More</summary>"));
});

test("word count splits blocks", () => {
  assert.equal(
    wordCount(sanitizeDoc(doc(p(t("one two")), p(t("three")), { type: "bulletList", content: [{ type: "listItem", content: [p(t("four"))] }] }))),
    4
  );
  assert.equal(wordCount(sanitizeDoc(doc(p(t("Hel", [{ type: "bold" }]), t("lo"))))), 1);
});

test("page sizes in CSS pixels", () => {
  assert.deepEqual(pageBox({ pageSize: "letter", orientation: "portrait", margin: "normal" }), {
    width: 816,
    height: 1056,
    margin: 96,
    contentHeight: 864,
    cssSize: "letter portrait"
  });
  const a4 = pageBox({ pageSize: "a4", orientation: "landscape", margin: "narrow" });
  assert.equal(a4.width, 1123);
  assert.equal(a4.height, 794);
  assert.equal(a4.margin, 48);
  assert.equal(a4.cssSize, "A4 landscape");
  assert.ok(printCss({ pageSize: "legal", orientation: "portrait", margin: "wide" }).includes("@page{size:legal portrait;margin:144px;"));
});

test("the splitter starts a page when a block would overflow, and after a page break", () => {
  const b = (top: number, h: number, forced = false) => ({ top, bottom: top + h, forced });
  assert.deepEqual(paginate([], 100), [0]);
  assert.deepEqual(paginate([b(0, 40), b(50, 40)], 100), [0]);
  assert.deepEqual(paginate([b(0, 40), b(50, 40), b(100, 40)], 100), [0, 2]);
  // A block taller than a page gets its own page and does not loop.
  assert.deepEqual(paginate([b(0, 10), b(20, 300), b(330, 10)], 100), [0, 1, 2]);
  // A page break starts a new page at the next block, and never makes an empty page.
  assert.deepEqual(paginate([b(0, 10), b(20, 0, true), b(30, 10)], 100), [0, 2]);
  assert.deepEqual(paginate([b(0, 95), b(100, 0, true), b(110, 10)], 100), [0, 2]);
  // A page break at the end adds no page.
  assert.deepEqual(paginate([b(0, 10), b(20, 0, true)], 100), [0]);
});

test("the splitter source runs on its own, as the share page sends it", () => {
  const fn = new Function(`return (${paginate.toString()})`)() as typeof paginate;
  assert.deepEqual(
    fn(
      [
        { top: 0, bottom: 60 },
        { top: 70, bottom: 130 }
      ],
      100
    ),
    [0, 1]
  );
});

test("uploads are checked by their bytes, not their name", () => {
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImage(new TextEncoder().encode("GIF89a....")), "image/gif");
  assert.equal(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>")), null);
  assert.equal(sniffImage(new TextEncoder().encode("<html><script>")), null);
});

test("share tokens have one shape", () => {
  assert.equal(isShareToken("a".repeat(43)), true);
  assert.equal(isShareToken("a".repeat(42)), false);
  assert.equal(isShareToken("a".repeat(42) + "/"), false);
  assert.equal(isShareToken("../../etc/passwd"), false);
});

test("the site's list of apps that are off survives bad data", () => {
  assert.deepEqual(parseAppsOff('["docs","projects"]'), ["docs", "projects"]);
  assert.deepEqual(parseAppsOff('["docs", 3, "Bad Id", null]'), ["docs"]);
  assert.deepEqual(parseAppsOff("not json"), []);
  assert.deepEqual(parseAppsOff('{"docs":true}'), []);
  assert.deepEqual(parseAppsOff(null), []);
});

/* Library rules */


const tree = [
  { id: "a", parentId: null, name: "Clients" },
  { id: "b", parentId: "a", name: "Acme" },
  { id: "c", parentId: "b", name: "Proposals" },
  { id: "d", parentId: "c", name: "2026" },
  { id: "e", parentId: "d", name: "Q1" },
  { id: "x", parentId: null, name: "Admin" }
];

test("names are one clean line with a length limit", () => {
  assert.deepEqual(cleanName("  Client   work\n", "Folder"), { name: "Client work" });
  assert.deepEqual(cleanName("   ", "Folder"), { problem: "Type a folder name." });
  assert.ok("problem" in cleanName("x".repeat(81), "Tag"));
  assert.ok("problem" in cleanName(7, "Tag"));
});

test("folder depth and nesting", () => {
  assert.equal(folderDepth(tree, null), 0);
  assert.equal(folderDepth(tree, "a"), 1);
  assert.equal(folderDepth(tree, "e"), 5);
  assert.equal(isInside(tree, "e", "a"), true);
  assert.equal(isInside(tree, "a", "e"), false);
  assert.equal(isInside(tree, "x", "a"), false);
});

test("folder moves stay out of loops and within 5 levels", () => {
  assert.equal(folderMoveProblem(tree, null, null), null);
  assert.equal(folderMoveProblem(tree, null, "d"), null);
  assert.match(folderMoveProblem(tree, null, "e")!, /5 levels/);
  assert.match(folderMoveProblem(tree, "a", "c")!, /cannot go inside itself/);
  assert.match(folderMoveProblem(tree, "a", "a")!, /cannot go inside itself/);
  // Clients has 5 levels, so it cannot go inside Admin.
  assert.match(folderMoveProblem(tree, "a", "x")!, /5 levels/);
  assert.equal(folderMoveProblem(tree, "c", "x"), null);
  assert.match(folderMoveProblem(tree, null, "nope")!, /does not exist/);
  // A loop in bad data does not hang.
  const loop = [
    { id: "p", parentId: "q", name: "P" },
    { id: "q", parentId: "p", name: "Q" }
  ];
  assert.equal(folderDepth(loop, "p"), 2);
});

test("folder paths list the tree in order", () => {
  assert.deepEqual(
    folderPaths(tree).map((p) => p.path),
    ["Admin", "Clients", "Clients / Acme", "Clients / Acme / Proposals", "Clients / Acme / Proposals / 2026", "Clients / Acme / Proposals / 2026 / Q1"]
  );
});

test("tag lists are clean, unique without regard to case, and short", () => {
  assert.deepEqual(cleanTagNames([" Q1 ", "q1", "Launch", "launch  plan"]), { names: ["Q1", "Launch", "launch plan"] });
  assert.ok("problem" in cleanTagNames("Q1"));
  assert.ok("problem" in cleanTagNames(["ok", ""]));
  assert.ok("problem" in cleanTagNames(Array.from({ length: 21 }, (_, i) => `t${i}`)));
});
