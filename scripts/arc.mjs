#!/usr/bin/env node
// Arc components for @openact/ui.
//
// Arc (https://github.com/kuratlielia/arc-library, MIT) is a library of React components with motion built in.
// This script copies Arc components into packages/ui/src/arc and changes them so they fit OpenAct:
//
// - Arc design tokens get an `--arc-` prefix. packages/ui/src/arc/arc.css maps them to the Promptbook tokens,
//   so Arc components use the OpenAct colors in both themes, and Arc never changes a shadcn/ui token.
// - Dark mode uses the `.dark` class on <html>, not `data-theme`.
// - Imports use relative paths and the `radix-ui` package that @openact/ui already uses.
//
// Usage:
//   npm run arc -- list                 List the Arc components and show which are installed.
//   npm run arc -- add <name> [...]     Install components and the components they use.
//   npm run arc -- add --all            Install every Arc component.
//   npm run arc -- update [--ref <sha>] Install the installed components again from the pinned (or a new) commit.
//   npm run arc -- catalog              Write packages/ui/src/arc/CATALOG.md again.
//
// Options: --from <path> reads a local clone of arc-library instead of GitHub.
//
// Never edit a file in packages/ui/src/arc/<name>/ by hand. `update` writes over it. Change this script or arc.css.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UI = join(ROOT, "packages/ui");
const OUT = join(UI, "src/arc");
const MANIFEST = join(UI, "arc.json");
const REPO = "https://github.com/kuratlielia/arc-library.git";
const CACHE = join(ROOT, "node_modules/.cache/arc-library");

/** Arc imports these packages one by one. @openact/ui uses the `radix-ui` package, which holds all of them. */
const RADIX = {
  "react-accordion": "Accordion",
  "react-checkbox": "Checkbox",
  "react-dialog": "Dialog",
  "react-dropdown-menu": "DropdownMenu",
  "react-popover": "Popover",
  "react-select": "Select",
  "react-switch": "Switch",
  "react-tabs": "Tabs",
  "react-tooltip": "Tooltip",
};

/** Arc lib files that components import. They go to packages/ui/src/arc/lib. */
const LIB = {
  "registry/motion-tokens.ts": "motion-tokens.ts",
  "lib/arc-provider.tsx": "arc-provider.tsx",
  "lib/use-copy-feedback.ts": "use-copy-feedback.ts",
  "lib/use-today.ts": "use-today.ts",
};

/** Tokens that components set to tune the foundation focus rule. Foundation reads them but does not define them. */
const EXTRA_TOKENS = ["focus-outline", "focus-outline-width", "focus-outline-offset"];
/** Token families that components build by name, such as `var(--series-${index + 1})`. */
const FAMILIES = ["series", "tone", "space", "text", "neutral", "shadow", "radius", "duration", "control-height"];

function fail(message) {
  console.error(`arc: ${message}`);
  process.exit(1);
}

function readManifest() {
  if (!existsSync(MANIFEST)) return { source: REPO, ref: "", components: [] };
  return JSON.parse(readFileSync(MANIFEST, "utf8"));
}

function writeManifest(m) {
  const sorted = { ...m, components: [...new Set(m.components)].sort() };
  writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + "\n");
}

/** Returns a folder with arc-library at the commit `ref`. */
function source({ from, ref }) {
  if (from) return from;
  if (!ref) fail("no commit is pinned. Run `npm run arc -- update --ref <sha>` once.");
  const dir = join(CACHE, ref);
  if (existsSync(join(dir, "registry.json"))) return dir;
  mkdirSync(dir, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("fetch", "-q", "--depth", "1", REPO, ref);
  git("checkout", "-q", "FETCH_HEAD");
  return dir;
}

function headOf(dir) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, stdio: "pipe" }).toString().trim();
  } catch {
    return "";
  }
}

/** The names of the tokens that registry/foundation.css defines. */
function foundationTokens(src) {
  const css = readFileSync(join(src, "registry/foundation.css"), "utf8");
  const names = new Set(EXTRA_TOKENS);
  for (const m of css.matchAll(/(?:^|[\s;{])--([a-z0-9-]+)\s*:/g)) if (!m[1].startsWith("arc-")) names.add(m[1]);
  // Longest first, so --space-10 is never read as --space-1.
  return [...names].sort((a, b) => b.length - a.length);
}

/** Changes one Arc file so it fits OpenAct. `depth` is how far the file is below packages/ui/src/arc. */
export function rewrite(text, { tokens, file, depth }) {
  let out = text;
  const up = depth === 0 ? "./" : "../".repeat(depth);

  // Tokens. A name that Arc already prefixes (--arc-gradient) stays as it is.
  const names = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  out = out.replace(new RegExp(`--(?!arc-)(${names})(?![\\w-])`, "g"), "--arc-$1");
  out = out.replace(new RegExp(`--(${FAMILIES.join("|")})-\\$\\{`, "g"), "--arc-$1-${");

  if (file.endsWith(".css")) {
    // Dark mode is the .dark class on <html>.
    out = out.replace(/:global\(\s*:root\[data-theme=["']dark["']\]\s*\)/g, ":global(.dark)");
    out = out.replace(/:global\(\s*\[data-theme=["']dark["']\]\s*\)/g, ":global(.dark)");
    out = out.replace(/:root\[data-theme=["']dark["']\]/g, ":global(.dark)");
    return out;
  }

  // Vite apps have no server components. Rollup warns about the directive, so it goes.
  out = out.replace(/^["']use client["'];?\s*\n/m, "");
  out = out.replace(/from\s+["']@\/components\/arc\/lib\/[\w-]+["']/g, 'from "@openact/ui/arc/lib"');
  out = out.replace(/from\s+["']@\/lib\/([\w-]+)["']/g, (_, name) => `from "${up}lib/${name}"`);
  out = out.replace(/from\s+["']@\/registry\/components\/([\w-]+)\/([\w-]+)["']/g, (_, dir, name) => `from "${up}${dir}/${name}"`);
  out = out.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+["']@radix-ui\/([\w-]+)["'];?/g, (all, alias, pkg) => {
    const part = RADIX[pkg];
    if (!part) fail(`${file} imports @radix-ui/${pkg}. Add it to RADIX in scripts/arc.mjs.`);
    return `import { ${part} as ${alias} } from "radix-ui";`;
  });
  // OpenAct text has no em dashes (cue C13).
  out = out.replace(/\s?—\s?/g, " - ");
  return out;
}

function registry(src) {
  return JSON.parse(readFileSync(join(src, "registry.json"), "utf8")).items;
}

/** The folder in registry/components that holds an item. Variants (theme-switch-rise) share their base folder. */
function folderOf(src, item) {
  if (existsSync(join(src, "registry/components", item.name))) return item.name;
  const first = item.files.find((f) => f.path.startsWith("registry/components/"));
  return first ? first.path.split("/")[2] : item.name;
}

/** Arc component names mapped to their folders. */
function components(src) {
  return new Map(registry(src).filter((i) => i.type === "registry:ui").map((i) => [i.name, folderOf(src, i)]));
}

/** The Arc components that `name` imports, read from its source. */
function usedComponents(src, name) {
  const dir = join(src, "registry/components", name);
  const found = new Set();
  for (const f of readdirSync(dir)) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const m of text.matchAll(/@\/registry\/components\/([\w-]+)\//g)) if (m[1] !== name) found.add(m[1]);
  }
  return [...found];
}

/** The entry for `@openact/ui/arc/<name>`. It also exports a default export by its name, so every import is named. */
export function indexFor(text, file) {
  const lines = [`export * from "./${file}";`];
  const m = text.match(/^export default (?:function\s+|class\s+)?([A-Z]\w*)/m);
  if (m) lines.push(`export { default, default as ${m[1]} } from "./${file}";`);
  else if (/^export default /m.test(text)) lines.push(`export { default } from "./${file}";`);
  return lines.join("\n") + "\n";
}

function header(src, ref, path) {
  return `/* Arc (MIT, Copyright (c) 2026 Elia Kuratli): ${path} at ${ref.slice(0, 12)}. Written by \`npm run arc\`. Do not edit. */\n`;
}

function install(src, names, ref) {
  const folders = components(src);
  const tokens = foundationTokens(src);
  const todo = names.map((n) => {
    if (!folders.has(n) && !existsSync(join(src, "registry/components", n))) fail(`"${n}" is not an Arc component. Run \`npm run arc -- list\`.`);
    return folders.get(n) ?? n;
  });
  const done = new Set();
  while (todo.length) {
    const name = todo.pop();
    if (done.has(name)) continue;
    done.add(name);
    todo.push(...usedComponents(src, name));
  }

  mkdirSync(join(OUT, "lib"), { recursive: true });
  // The MIT license asks that its notice goes with every copy.
  writeFileSync(join(OUT, "LICENSE"), readFileSync(join(src, "LICENSE"), "utf8"));
  for (const [from, to] of Object.entries(LIB)) {
    const text = rewrite(readFileSync(join(src, from), "utf8"), { tokens, file: to, depth: 1 });
    writeFileSync(join(OUT, "lib", to), header(src, ref, from) + text);
  }
  writeFileSync(join(OUT, "lib", "index.ts"), Object.values(LIB).map((f) => `export * from "./${f.replace(/\.tsx?$/, "")}";`).join("\n") + "\n");

  for (const name of done) {
    const target = join(OUT, name);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    const dir = join(src, "registry/components", name);
    const files = readdirSync(dir);
    for (const f of files) {
      const text = rewrite(readFileSync(join(dir, f), "utf8"), { tokens, file: f, depth: 1 });
      writeFileSync(join(target, f), header(src, ref, `registry/components/${name}/${f}`) + text);
    }
    const main = files.find((f) => f === `${name}.tsx`) ?? files.find((f) => f.endsWith(".tsx"));
    if (main) writeFileSync(join(target, "index.ts"), indexFor(readFileSync(join(target, main), "utf8"), main.replace(/\.tsx$/, "")));
  }
  return [...done];
}

function catalog(src) {
  const m = readManifest();
  const installed = new Set(m.components);
  const items = registry(src)
    .filter((i) => i.type === "registry:ui")
    .map((i) => ({ ...i, folder: folderOf(src, i) }))
    .filter((i) => installed.has(i.folder));
  const groups = new Map();
  for (const i of items) {
    const g = i.categories?.[0] ?? "other";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(i);
  }
  const clean = (s) => String(s ?? "").replace(/—/g, "-").replace(/\|/g, "/");
  const lines = [
    "# Arc components in @openact/ui",
    "",
    "Written by `npm run arc -- catalog`. Do not edit.",
    "",
    `Source: [arc-library](https://github.com/kuratlielia/arc-library) at \`${m.ref.slice(0, 12)}\` (MIT). Live previews: https://uiarc.dev/components/<name>.`,
    "",
    "Import a component from `@openact/ui/arc/<name>`, for example `import { Button } from \"@openact/ui/arc/button\";`.",
    "Read [docs/components.md](../../../../docs/components.md) before you pick a component.",
    "",
  ];
  for (const g of [...groups.keys()].sort()) {
    lines.push(`## ${g[0].toUpperCase()}${g.slice(1)}`, "", "| Name | What it is | Import |", "| --- | --- | --- |");
    for (const i of groups.get(g).sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`| ${clean(i.title)} | ${clean(i.description)} | \`@openact/ui/arc/${i.folder}\` |`);
    }
    lines.push("");
  }
  writeFileSync(join(OUT, "CATALOG.md"), lines.join("\n"));
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args.shift();
  const opt = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const from = opt("--from");
  const newRef = opt("--ref");
  const m = readManifest();

  if (cmd === "list") {
    const src = source({ from, ref: m.ref });
    const installed = new Set(m.components);
    for (const i of registry(src).filter((x) => x.type === "registry:ui")) {
      console.log(`${installed.has(folderOf(src, i)) ? "*" : " "} ${i.name.padEnd(26)} ${String(i.description).replace(/—/g, "-")}`);
    }
    return;
  }
  if (cmd === "add" || cmd === "update") {
    const ref = newRef ?? (from ? headOf(from) : m.ref);
    const src = source({ from, ref });
    let names = args;
    if (cmd === "update") names = m.components;
    if (args.includes("--all")) names = [...new Set(components(src).values())];
    if (!names.length) fail("name one or more components, or use --all.");
    const done = install(src, names, ref);
    writeManifest({ source: REPO, ref, components: [...(cmd === "update" ? [] : m.components), ...done] });
    catalog(src);
    console.log(`arc: installed ${done.length} component(s) from ${ref.slice(0, 12)} into ${relative(ROOT, OUT)}.`);
    return;
  }
  if (cmd === "catalog") {
    catalog(source({ from, ref: m.ref }));
    return;
  }
  console.log("Usage: npm run arc -- list | add <name...> | add --all | update [--ref <sha>] | catalog  [--from <path>]");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
