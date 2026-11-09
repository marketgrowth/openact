import { contentCss, DOC_FONT, pageBox, paginate, printCss } from "../shared/page";
import { escapeHtml, renderHtml } from "../shared/content";
import type { DocNode, PageSettings } from "../shared/types";

/*
 * The paper page for a doc: the public share page and the signed-in print page.
 * It renders the cleaned doc on the server, then a small script splits it into sheets of the page size.
 * Each sheet prints as one page, so the PDF matches the screen. Without the script, the doc shows on one long sheet.
 */

export interface PaperPage {
  title: string;
  siteName: string;
  doc: DocNode;
  settings: PageSettings;
  updatedAt: string;
  /** Maps an in-app image path to the URL for this page. */
  imageUrl: (src: string) => string | null;
  /** A fresh random value for the Content-Security-Policy of this response. */
  nonce: string;
  /** "print" opens the print dialog when the page is ready. */
  mode: "share" | "print";
}

const FONTS = "https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap";

/** The Content-Security-Policy for a paper page. Only this page's own style and script run. */
export const paperCsp = (nonce: string) =>
  [
    "default-src 'none'",
    "img-src 'self'",
    `style-src 'nonce-${nonce}' https://fonts.googleapis.com`,
    "font-src https://fonts.gstatic.com",
    `script-src 'nonce-${nonce}'`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join("; ");

/** Headers for every paper page and share link reply. */
export const paperHeaders = (nonce?: string): Record<string, string> => ({
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": nonce ? paperCsp(nonce) : "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"
});

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export function paperPageHtml(p: PaperPage): string {
  const box = pageBox(p.settings);
  const r = renderHtml(p.doc, { imageUrl: p.imageUrl });
  const title = escapeHtml(p.title || "Untitled doc");
  const n = escapeHtml(p.nonce);
  const toc =
    r.outline.length >= 2
      ? `<nav class="toc no-print" aria-label="Contents"><p>Contents</p><ol>${r.outline
          .map((h) => `<li class="l${h.level}"><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`)
          .join("")}</ol></nav>`
      : "";

  const css = `
:root{--doc-fg:#1c1824;--doc-muted:#6b6576;--doc-border:#d9d5de;--doc-soft:#f3f1f5;--doc-link:#1f4fd1;--desk:#e8e6eb;--paper:#fff;--bar:#ffffffee;--bar-fg:#1c1824;--bar-muted:#6b6576;--bar-border:#d9d5de}
@media (prefers-color-scheme:dark){:root{--desk:#1a181e;--bar:#1f1d24ee;--bar-fg:#ece7f2;--bar-muted:#a59fae;--bar-border:#34313b}}
*{box-sizing:border-box}
html{scroll-padding-top:72px}
body{margin:0;background:var(--desk);font-family:${DOC_FONT};-webkit-font-smoothing:antialiased}
.bar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--bar);color:var(--bar-fg);border-bottom:1px solid var(--bar-border);backdrop-filter:blur(8px)}
.bar .t{flex:1;min-width:0;display:grid;line-height:1.25}
.bar .t b{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar .t span{font-size:12px;color:var(--bar-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar button{font:inherit;font-size:13px;font-weight:500;padding:7px 12px;border-radius:8px;border:1px solid var(--bar-border);background:var(--bar-fg);color:var(--desk);cursor:pointer}
.bar button:focus-visible{outline:3px solid var(--doc-link);outline-offset:2px}
.layout{display:flex;justify-content:center;align-items:flex-start;gap:24px;padding:24px 16px 64px}
.toc{position:sticky;top:72px;width:220px;flex:none;font-size:13px;color:var(--bar-fg);max-height:calc(100vh - 96px);overflow:auto}
.toc p{margin:0 0 8px;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--bar-muted)}
.toc ol{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.toc a{color:inherit;text-decoration:none;display:block;padding:2px 6px;border-radius:6px}
.toc a:hover{background:var(--bar-border)}
.toc .l2{padding-left:10px}.toc .l3{padding-left:20px}.toc .l4{padding-left:30px}
.desk{display:flex;flex-direction:column;align-items:center;gap:24px;transform-origin:top center}
.sheet{background:var(--paper);width:${box.width}px;min-height:${box.height}px;padding:${box.margin}px;box-shadow:0 1px 2px #0000001a,0 4px 16px #00000014;border-radius:2px}
.sheet.fit{height:${box.height}px;overflow:hidden}
.sheet-body{position:relative}
.sheet-body > :first-child{margin-top:0}
@media (max-width:${box.width + 300}px){.toc{display:none}}
${contentCss(".doc-content")}
${printCss(p.settings)}
@media print{.layout{display:block;padding:0}.desk{zoom:1!important}}
`;

  // The page splitter is the same function the editor uses, sent as source.
  const script = `
(function(){
  var paginate = ${paginate.toString()};
  var H = ${box.contentHeight}, W = ${box.width};
  var desk = document.getElementById("desk"), flow = document.getElementById("flow");
  function split(){
    var els = Array.prototype.slice.call(flow.children);
    if (!els.length) return;
    var blocks = els.map(function(el){ return { top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight, forced: el.hasAttribute("data-page-break") }; });
    var starts = paginate(blocks, H);
    for (var p = 1; p < starts.length; p++) {
      var sheet = document.createElement("article"); sheet.className = "sheet";
      var body = document.createElement("div"); body.className = "sheet-body doc-content";
      sheet.appendChild(body);
      var end = p + 1 < starts.length ? starts[p + 1] : els.length;
      for (var i = starts[p]; i < end; i++) body.appendChild(els[i]);
      desk.appendChild(sheet);
    }
    var sheets = desk.querySelectorAll(".sheet");
    for (var s = 0; s < sheets.length; s++) {
      var b = sheets[s].firstElementChild;
      if (b && b.scrollHeight <= H + 1) sheets[s].classList.add("fit");
    }
    document.documentElement.setAttribute("data-pages", String(starts.length));
  }
  function fit(){
    var room = document.documentElement.clientWidth - 32;
    desk.style.zoom = room < W ? String(Math.max(0.3, room / W)) : "";
  }
  var opened = [];
  window.addEventListener("beforeprint", function(){
    opened = Array.prototype.filter.call(document.querySelectorAll("details:not([open])"), function(d){ d.open = true; return true; });
  });
  window.addEventListener("afterprint", function(){ opened.forEach(function(d){ d.open = false; }); opened = []; });
  var btn = document.getElementById("print");
  if (btn) btn.addEventListener("click", function(){ window.print(); });
  function ready(){
    split(); fit();
    window.addEventListener("resize", fit);
    ${p.mode === "print" ? "setTimeout(function(){ window.print(); }, 300);" : ""}
  }
  var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  var loaded = document.readyState === "complete" ? Promise.resolve() : new Promise(function(r){ window.addEventListener("load", r); });
  Promise.all([fonts, loaded]).then(ready, ready);
})();`;

  const updated = fmtDate(p.updatedAt);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<link rel="stylesheet" href="${FONTS}">
<style nonce="${n}">${css}</style>
</head>
<body>
<header class="bar no-print">
<div class="t"><b>${title}</b><span>${updated ? `Updated ${escapeHtml(updated)} · ` : ""}${escapeHtml(p.siteName)}</span></div>
<button type="button" id="print">Print or save as PDF</button>
</header>
<div class="layout">
${toc}
<main class="desk" id="desk">
<article class="sheet"><div class="sheet-body doc-content" id="flow">${r.blocks.join("\n")}</div></article>
</main>
</div>
<script nonce="${n}">${script}</script>
</body>
</html>`;
}

/** A small page for a link that does not work. */
export function linkProblemHtml(title: string, text: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f3f6;color:#1c1824;font-family:${DOC_FONT}}main{max-width:420px;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#6b6576;line-height:1.5}@media (prefers-color-scheme:dark){body{background:#1a181e;color:#ece7f2}p{color:#a59fae}}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></main></body></html>`;
}
