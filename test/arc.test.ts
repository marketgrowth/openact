import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error The Arc script is plain JavaScript with no type file.
import { indexFor, rewrite } from "../scripts/arc.mjs";

const ARC = "packages/ui/src/arc";

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(tsx?|css)$/.test(name) && name !== "arc.css") out.push(p);
  }
  return out;
}

test("every --arc- token that an Arc component reads has a value in arc.css", () => {
  const map = readFileSync(join(ARC, "arc.css"), "utf8");
  const defined = new Set([...map.matchAll(/(--arc-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const missing = new Set<string>();
  for (const file of files(ARC)) {
    const text = readFileSync(file, "utf8");
    const local = new Set([...text.matchAll(/(--arc-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    for (const m of text.matchAll(/var\((--arc-[a-z0-9-]+)(?![\w$-])/g)) {
      if (!defined.has(m[1]) && !local.has(m[1]) && !/-(width|offset)$/.test(m[1])) missing.add(`${m[1]} in ${file}`);
    }
  }
  assert.deepEqual([...missing], [], "Map each token to a Promptbook token in packages/ui/src/arc/arc.css.");
});

test("Arc components use OpenAct imports and the .dark class", () => {
  const problems: string[] = [];
  for (const file of files(ARC)) {
    const text = readFileSync(file, "utf8");
    if (/from\s+["']@\//.test(text)) problems.push(`${file} imports from @/`);
    if (/from\s+["']@radix-ui\//.test(text)) problems.push(`${file} imports a @radix-ui package. Use radix-ui.`);
    if (file.endsWith(".css") && /(:root\[|:global\(\s*\[)data-theme=["']dark/.test(text)) problems.push(`${file} uses data-theme for dark mode`);
    if (text.includes("—")) problems.push(`${file} has an em dash`);
  }
  assert.deepEqual(problems, [], "Run npm run arc -- update.");
});

test("every installed Arc component has an entry with a named export", () => {
  const manifest = JSON.parse(readFileSync("packages/ui/arc.json", "utf8")) as { components: string[] };
  for (const name of manifest.components) {
    const index = join(ARC, name, "index.ts");
    assert.ok(existsSync(index), `${index} is missing. Run npm run arc -- update.`);
  }
});

test("the Arc rewrite maps tokens, dark mode and imports", () => {
  const tokens = ["accent", "space-1", "space-10", "focus-outline-offset"];
  const css = rewrite(':global(:root[data-theme="dark"]) .a { color: var(--accent); gap: var(--space-10) var(--space-1); --focus-outline-offset: -2px; background: var(--arc-gradient); }', { tokens, file: "a.module.css", depth: 1 });
  assert.equal(css, ":global(.dark) .a { color: var(--arc-accent); gap: var(--arc-space-10) var(--arc-space-1); --arc-focus-outline-offset: -2px; background: var(--arc-gradient); }");

  const tsx = rewrite('"use client";\nimport * as DialogPrimitive from "@radix-ui/react-dialog";\nimport { motionTokens } from "@/lib/motion-tokens";\nimport { Button } from "@/registry/components/button/button";\nconst c = `var(--series-${i})`; // a — b', { tokens, file: "a.tsx", depth: 1 });
  assert.equal(tsx, 'import { Dialog as DialogPrimitive } from "radix-ui";\nimport { motionTokens } from "../lib/motion-tokens";\nimport { Button } from "../button/button";\nconst c = `var(--arc-series-${i})`; // a - b');

  assert.equal(indexFor("export default function SegmentedControl() {}", "segmented-control"), 'export * from "./segmented-control";\nexport { default, default as SegmentedControl } from "./segmented-control";\n');
});
