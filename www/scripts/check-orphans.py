#!/usr/bin/env python3
"""Check the built site for orphan words.

An orphan is a block of text whose last line holds one word. This script builds nothing. Run `npm run build` first.
It serves dist/, opens every page at ten widths and looks at every block of running text. A block is the nearest
element that is not inline. Each word counts by its last fragment, so a word that breaks at a hyphen is not an orphan.
design.html is skipped: `npm run design -- build` generates it.

Needs Python Playwright and Chrome:  pip install playwright   (set CHROME if Chrome is not at /usr/bin/google-chrome)
Run from www/:  python3 scripts/check-orphans.py [page.html,page.html]
Exit code 1 when it finds an orphan.
"""
import os, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

JS = r"""()=>{
 const SKIP='svg,pre,code,script,style,textarea,[aria-hidden="true"]';
 const isInline=e=>{const d=getComputedStyle(e).display;return d==='inline'||d==='contents';};
 // the block that owns a text node = nearest ancestor that is not display:inline
 const owner=n=>{let e=n.parentElement;while(e&&isInline(e)&&e!==document.body)e=e.parentElement;return e;};
 const blocks=new Map(); const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n;
 while(n=walker.nextNode()){
   if(!n.textContent.trim())continue; const p=n.parentElement;
   if(p.closest(SKIP))continue; const o=owner(n); if(!o)continue;
   const cs=getComputedStyle(o); if(cs.display==='none'||cs.visibility==='hidden')continue;
   if(!blocks.has(o))blocks.set(o,[]); blocks.get(o).push(n);
 }
 const out=[]; const r=document.createRange();
 for(const [o,nodes] of blocks){
   const words=[];
   for(const nd of nodes){const re=/\S+/g,t=nd.textContent;let m;
     while(m=re.exec(t)){r.setStart(nd,m.index);r.setEnd(nd,m.index+m[0].length);
       const rc=r.getClientRects();if(!rc.length)continue;const b=rc[rc.length-1];if(!b.width)continue;
       words.push({w:m[0],top:b.top,h:b.height});}}
   if(words.length<2)continue;
   const lines=[];for(const w of words){const L=lines.find(l=>Math.abs(l.top-w.top)<w.h*0.5);if(L)L.ws.push(w.w);else lines.push({top:w.top,ws:[w.w]});}
   if(lines.length<2)continue; lines.sort((a,b)=>a.top-b.top);
   const last=lines[lines.length-1];
   if(last.ws.length===1) out.push({tag:o.tagName+(o.className&&typeof o.className==='string'?'.'+o.className.split(' ')[0]:''),text:words.slice(-4).map(x=>x.w).join(' ')});
 }
 return out;}"""

DIST = Path(__file__).resolve().parent.parent / "dist"
PORT = 4399
WIDTHS = [1440, 1280, 1100, 1024, 900, 768, 600, 480, 390, 360]
pages = sys.argv[1].split(",") if len(sys.argv) > 1 else sorted(p.name for p in DIST.glob("*.html") if p.name != "design.html")
server = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)], cwd=DIST, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
found = {}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"), args=["--no-sandbox"])
        for page in pages:
            for w in WIDTHS:
                pg = browser.new_page(viewport={"width": w, "height": 900})
                pg.goto(f"http://localhost:{PORT}/{page}")
                pg.wait_for_timeout(150)
                for x in pg.evaluate(JS):
                    found.setdefault((page, x["tag"], x["text"]), []).append(w)
                pg.close()
        browser.close()
finally:
    server.terminate()
for (page, tag, text), ws in sorted(found.items()):
    print(f"{page:16} {tag:26} '{text}'  at {ws}")
print(f"{len(pages)} pages, {len(WIDTHS)} widths, {len(found)} orphans")
sys.exit(1 if found else 0)
