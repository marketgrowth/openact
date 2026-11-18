// The OpenAct Promptbook tools: checks, app seeds and the published copy at https://openact.ing/design.
// The command line is scripts/design.mjs. test/design.test.ts runs the same checks with the unit tests.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const THEME = "packages/ui/src/theme.css";
const BOOK = "packages/ui/promptbook.json";
const DOC = "docs/design-system.md";
const OUT_DIR = "www/public/design";
const PAGE = "www/src/pages/design.astro";

const read = (p) => readFileSync(join(ROOT, p), "utf8");

export function loadBook() {
  return JSON.parse(read(BOOK));
}

// ---------- Theme parsing ----------

/** Reads the custom properties in one CSS block, such as ":root {" or ".dark {". */
function block(css, opener) {
  const at = css.indexOf(opener);
  if (at < 0) return {};
  let depth = 0;
  let i = css.indexOf("{", at);
  const start = i + 1;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) break;
  }
  const body = css.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, "");
  const out = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

export function loadTheme(css = read(THEME)) {
  return { light: block(css, ":root {"), dark: block(css, ".dark {"), theme: block(css, "@theme inline {") };
}

/** The value of a token in a theme. Dark falls back to the light value, like CSS does. */
export function valueOf(theme, mode, name) {
  return mode === "dark" ? (theme.dark[name] ?? theme.light[name]) : theme.light[name];
}

// ---------- Color math ----------

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** OKLCH to linear sRGB. Values outside 0 to 1 are out of gamut. */
export function oklchToLinear(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
}

/** Parses a hex or oklch() color to linear sRGB and alpha. Returns null for other values. */
export function parseColor(v) {
  if (!v) return null;
  v = v.trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { rgb: [toLinear(n(0)), toLinear(n(2)), toLinear(n(4))], alpha: h.length === 8 ? n(6) : 1 };
  }
  m = v.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/);
  if (m) {
    const L = m[2] ? Number(m[1]) / 100 : Number(m[1]);
    const alpha = m[5] === undefined ? 1 : m[6] ? Number(m[5]) / 100 : Number(m[5]);
    return { rgb: oklchToLinear(L, Number(m[3]), Number(m[4])).map((c) => Math.min(1, Math.max(0, c))), alpha };
  }
  return null;
}

/** Linear sRGB to OKLab, for the distance between two colors. */
function toOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** The OKLab distance between two colors. Under 0.1 most people see them as the same color. */
export function distance(a, b) {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return null;
  const [p, q] = [toOklab(x.rgb), toOklab(y.rgb)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** WCAG contrast ratio. A see-through foreground is mixed over the background first. */
export function contrast(fg, bg) {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return null;
  const mixed = f.rgb.map((c, i) => toLinear(toGamma(c) * f.alpha + toGamma(b.rgb[i]) * (1 - f.alpha)));
  const [hi, lo] = [luminance(mixed), luminance(b.rgb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function toHex(rgb) {
  return "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255).toString(16).padStart(2, "0")).join("");
}

// ---------- Checks ----------

const COLOR_GROUPS_WITHOUT_CLASS = new Set(["identity"]);
const NOT_COLORS = /^(radius|motion-|font-|dayw)/;

function walk(dir, exts, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

function appIds() {
  const listed = JSON.parse(read("openact.apps.json")).apps.map((a) => a.id);
  const folders = existsSync(join(ROOT, "apps")) ? readdirSync(join(ROOT, "apps")) : [];
  return new Set([...listed, ...folders]);
}

const PALETTE = "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";
const PALETTE_CLASS = new RegExp(`\\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|caret|shadow|ring-offset)-(?:(?:${PALETTE})-\\d{2,3}|white|black)\\b`);
const LITERAL = /(["'`\s(:])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?|oklch|oklab)\(/;
const ALLOW = "promptbook-allow";

/** The client code that cue C01 checks. */
export function clientFiles() {
  const apps = existsSync(join(ROOT, "apps")) ? readdirSync(join(ROOT, "apps")).map((a) => `apps/${a}/src/client`) : [];
  return [...walk("packages/ui/src", [".tsx", ".ts"]), ...walk("src/client", [".tsx", ".ts"]), ...apps.flatMap((d) => walk(d, [".tsx", ".ts"]))];
}

/** Runs every script check. Returns a list of problems. An empty list means the cues pass. */
export function check({ book = loadBook(), theme = loadTheme() } = {}) {
  const problems = [];
  const add = (cue, text) => problems.push({ cue, text });

  // C02: every token has a value in both themes, and a Tailwind class where it needs one.
  for (const [group, def] of Object.entries(book.tokens)) {
    for (const name of Object.keys(def.items)) {
      if (!(name in theme.light)) add("C02", `--${name} is in the Promptbook but not in :root in ${THEME}. Add a light value.`);
      if (!(name in theme.dark)) add("C02", `--${name} has no dark value. Add it to .dark in ${THEME}.`);
      const cls = book.classes[name] ?? name;
      if (!COLOR_GROUPS_WITHOUT_CLASS.has(group) && !(`color-${cls}` in theme.theme)) add("C02", `--${name} has no class. Add --color-${cls}: var(--${name}) to @theme inline.`);
    }
  }
  const listed = new Set(Object.values(book.tokens).flatMap((g) => Object.keys(g.items)));
  for (const name of Object.keys(theme.light)) {
    if (NOT_COLORS.test(name)) continue;
    if (!(name in theme.dark)) add("C02", `--${name} has no dark value. Add it to .dark in ${THEME}.`);
    if (!listed.has(name) && !/^(sidebar|stage-|paper-|warn-|av-ink|bar-ink|weekend|brand-)/.test(name) && !name.startsWith("app-")) {
      add("C02", `--${name} is not in the Promptbook. Add it to a group in ${BOOK} with its intent.`);
    }
  }

  // C03 and C04: contrast in both themes.
  for (const [kind, min] of [["text", 4.5], ["graphic", 3]]) {
    for (const [fg, bg] of book.contrast[kind]) {
      for (const mode of ["light", "dark"]) {
        const ratio = contrast(valueOf(theme, mode, fg), valueOf(theme, mode, bg));
        if (ratio === null) add(kind === "text" ? "C03" : "C04", `Cannot read --${fg} or --${bg} in ${mode}. Use a hex or oklch() value.`);
        else if (ratio < min) add(kind === "text" ? "C03" : "C04", `--${fg} on --${bg} is ${ratio.toFixed(2)}:1 in ${mode}. It needs ${min}:1.`);
      }
    }
  }

  // C09: agent work never looks like a brand message.
  for (const state of book.agentStates) {
    for (const brand of ["brand", "brand-gold"]) {
      for (const mode of ["light", "dark"]) {
        const d = distance(valueOf(theme, mode, state.token), valueOf(theme, mode, brand));
        if (d !== null && d < 0.1) add("C09", `--${state.token} is too close to --${brand} in ${mode} (${d.toFixed(3)}). Agent states must not look like the brand.`);
      }
    }
  }

  const states = book.agentStates.map((st) => st.token);
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      for (const mode of ["light", "dark"]) {
        const d = distance(valueOf(theme, mode, states[i]), valueOf(theme, mode, states[j]));
        if (d !== null && d < 0.08) add("C09", `--${states[i]} and --${states[j]} look alike in ${mode} (${d.toFixed(3)}). People must tell agent states apart.`);
      }
    }
  }

  // C14: app tokens start with an app id.
  const ids = appIds();
  for (const name of [...Object.keys(theme.light), ...Object.keys(theme.dark), ...Object.keys(theme.theme)]) {
    const m = name.match(/^(?:color-)?app-([a-z0-9]+)-/);
    if (name.match(/^(?:color-)?app-/) && (!m || !ids.has(m[1]))) add("C14", `--${name} does not start with a known app id. Use --app-<id>-<name>.`);
  }

  // C01: no literal colors or palette classes in client code. C13: no em dashes in text.
  for (const file of clientFiles()) {
    read(file).split("\n").forEach((line, i) => {
      if (line.includes(ALLOW)) return;
      if (LITERAL.test(line)) add("C01", `${file}:${i + 1} has a literal color. Use a theme token.`);
      const pc = line.match(PALETTE_CLASS);
      if (pc) add("C01", `${file}:${i + 1} uses the palette class ${pc[0]}. Use a token class such as bg-muted.`);
    });
  }
  const textFiles = [...clientFiles(), ...walk("docs", [".md"]), ...walk("www/src", [".astro", ".md"]), ...walk("www/public", [".html", ".md"]), BOOK];
  for (const file of textFiles) {
    read(file).split("\n").forEach((line, i) => {
      if (line.includes("—") && !line.includes(ALLOW)) add("C13", `${file}:${i + 1} has an em dash. Use a period, a comma or a colon.`);
    });
  }
  return problems;
}

// ---------- App seeds ----------

function inGamut(rgb) {
  return rgb.every((c) => c >= -0.0005 && c <= 1.0005);
}

/** The most colorful in-gamut value at a lightness and hue, up to a chroma limit. */
function fit(L, H, maxC) {
  for (let C = maxC; C >= 0; C -= 0.005) {
    const rgb = oklchToLinear(L, C, H);
    if (inGamut(rgb)) return { L, C, rgb };
  }
  return { L, C: 0, rgb: oklchToLinear(L, 0, H) };
}

/**
 * Makes an app accent from one hue. The light value is the lightest that keeps 4.6:1 on the light card and page.
 * The dark value starts bright (OKLCH lightness 0.74) and keeps 4.6:1 on the dark card and page.
 * Each gets a text color for fills, white or near black, whichever has more contrast.
 */
export function seed(id, hue, { chroma = 0.16, theme = loadTheme() } = {}) {
  if (!/^[a-z][a-z0-9]*$/.test(id)) throw new Error("The app id must be lowercase letters and numbers, such as docs.");
  const H = Number(hue);
  if (!Number.isFinite(H) || H < 0 || H > 360) throw new Error("The hue must be a number from 0 to 360.");
  const pick = (mode) => {
    const surfaces = ["background", "card"].map((n) => valueOf(theme, mode, n));
    const steps = mode === "light" ? Array.from({ length: 90 }, (_, i) => 0.9 - i * 0.006) : Array.from({ length: 40 }, (_, i) => 0.74 + i * 0.006);
    for (const L of steps) {
      const c = fit(L, H, chroma);
      const hex = toHex(c.rgb);
      if (surfaces.every((s) => contrast(hex, s) >= 4.6)) {
        const ink = ["#ffffff", "#0d0f14"].sort((a, b) => contrast(b, hex) - contrast(a, hex))[0];
        return { hex, ink, ratio: Math.min(...surfaces.map((s) => contrast(hex, s))), inkRatio: contrast(ink, hex) };
      }
    }
    throw new Error(`No ${mode} value at hue ${H} reaches 4.6:1. Try a lower chroma.`);
  };
  const light = pick("light");
  const dark = pick("dark");
  const css = `/* App accent for ${id}, made by \`npm run design -- seed ${id} ${H}\`. Paste each part into packages/ui/src/theme.css. */

/* In :root */
  --app-${id}-accent: ${light.hex}; /* ${light.ratio.toFixed(2)}:1 on page and card */
  --app-${id}-accent-foreground: ${light.ink}; /* ${light.inkRatio.toFixed(2)}:1 on the accent */

/* In .dark */
  --app-${id}-accent: ${dark.hex}; /* ${dark.ratio.toFixed(2)}:1 on page and card */
  --app-${id}-accent-foreground: ${dark.ink}; /* ${dark.inkRatio.toFixed(2)}:1 on the accent */

/* In @theme inline */
  --color-app-${id}-accent: var(--app-${id}-accent);
  --color-app-${id}-accent-foreground: var(--app-${id}-accent-foreground);
`;
  return { light, dark, css };
}

// ---------- The published copy ----------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The Promptbook with every token value and contrast ratio filled in. Agents fetch this file. */
export function resolved({ book = loadBook(), theme = loadTheme() } = {}) {
  const tokens = {};
  for (const [group, def] of Object.entries(book.tokens)) {
    tokens[group] = { intent: def.intent, items: {} };
    for (const [name, intent] of Object.entries(def.items)) {
      const cls = book.classes[name] ?? name;
      tokens[group].items[name] = {
        intent,
        css: `var(--${name})`,
        class: COLOR_GROUPS_WITHOUT_CLASS.has(group) ? null : cls,
        light: valueOf(theme, "light", name),
        dark: valueOf(theme, "dark", name)
      };
    }
  }
  const pairs = [];
  for (const [kind, min] of [["text", 4.5], ["graphic", 3]]) {
    for (const [fg, bg] of book.contrast[kind]) {
      const r = (mode) => Number(contrast(valueOf(theme, mode, fg), valueOf(theme, mode, bg)).toFixed(2));
      pairs.push({ fg, bg, kind, min, light: r("light"), dark: r("dark") });
    }
  }
  const { $comment, classes, contrast: _c, ...rest } = book;
  return {
    $comment: "Made by `npm run design -- build` from packages/ui/promptbook.json and packages/ui/src/theme.css in https://github.com/marketgrowth/openact. Do not edit this copy.",
    ...rest,
    tokens,
    contrast: pairs
  };
}

function swatch(v) {
  return `<i class="sw" style="background:${esc(v)}"></i>`;
}

function tokenRows(data) {
  const groups = ["agent", "meaning", "brand", "action", "surface"];
  return groups
    .map((g) => {
      const def = data.tokens[g];
      const rows = Object.entries(def.items)
        .map(([name, t]) => `<tr><td><code>${t.class ? esc(t.class) : "--" + esc(name)}</code></td><td>${esc(t.intent)}</td><td class="v">${swatch(t.light)}<span>${esc(t.light)}</span></td><td class="v">${swatch(t.dark)}<span>${esc(t.dark)}</span></td></tr>`)
        .join("\n");
      return `<tbody><tr class="grp"><th colspan="4">${esc(g)}<span>${esc(def.intent)}</span></th></tr>\n${rows}\n</tbody>`;
    })
    .join("\n");
}

function contrastRows(data) {
  const pick = ["foreground/background", "muted-foreground/background", "agent-wait/card", "agent-act/card", "destructive/card", "s-doing/card"];
  return data.contrast
    .filter((p) => pick.includes(`${p.fg}/${p.bg}`))
    .map((p) => {
      const low = Math.min(p.light, p.dark);
      const grade = p.kind === "graphic" ? (low >= 3 ? "3:1 ok" : "fail") : low >= 7 ? "AAA" : low >= 4.5 ? "AA" : "fail";
      const w = Math.min(100, Math.round((low / 21) * 100 * 3));
      return `<li><span>${esc(p.fg)} / ${esc(p.bg)}</span><i style="--w:${w}%"></i><b>${low.toFixed(1)}:1 ${grade}</b></li>`;
    })
    .join("\n");
}

function cueRows(data) {
  return data.cues.map((c) => `<tr><td class="id">${esc(c.id)}</td><td>${esc(c.rule)}</td><td><span class="chk ${esc(c.check)}">${esc(c.check)}</span></td></tr>`).join("\n");
}

/** CSS variables for the page, so openact.ing/design draws itself with the real token values. Dark first, like the site. */
function pageVars(data) {
  const groups = ["surface", "action", "meaning", "agent", "brand", "stage"];
  const decl = (mode) =>
    groups
      .flatMap((g) => Object.entries(data.tokens[g].items).map(([name, t]) => `--pb-${name}: ${t[mode]};`))
      .join(" ");
  return `<style is:inline>
      :root { ${decl("dark")} }
      @media (prefers-color-scheme: light) { :root { ${decl("light")} } }
    </style>`;
}

function fill(html, key, body) {
  const re = new RegExp(`(<!-- promptbook:${key} -->)[\\s\\S]*?(<!-- /promptbook:${key} -->)`);
  if (!re.test(html)) throw new Error(`${PAGE} has no promptbook:${key} markers.`);
  return html.replace(re, `$1\n${body}\n$2`);
}

/** Writes the published copy. With dryRun, returns the files that are out of date and writes nothing. */
export function build({ dryRun = false } = {}) {
  const data = resolved();
  const doc = read(DOC).replace(/^---[\s\S]*?---\n/, "");
  const files = {
    [`${OUT_DIR}/promptbook.json`]: JSON.stringify(data, null, 2) + "\n",
    [`${OUT_DIR}/promptbook.md`]: `<!-- Made by \`npm run design -- build\` from docs/design-system.md. The machine copy is https://openact.ing/design/promptbook.json. -->\n\n${doc}`
  };
  if (existsSync(join(ROOT, PAGE))) {
    let html = read(PAGE);
    html = fill(html, "vars", pageVars(data));
    html = fill(html, "tokens", tokenRows(data));
    html = fill(html, "contrast", contrastRows(data));
    html = fill(html, "cues", cueRows(data));
    html = fill(html, "version", `<span class="ver">v${esc(data.version)} · ${data.cues.length} cues · ${Object.values(data.tokens).reduce((n, g) => n + Object.keys(g.items).length, 0)} tokens</span>`);
    files[PAGE] = html;
  }
  const stale = Object.entries(files).filter(([p, body]) => !existsSync(join(ROOT, p)) || read(p) !== body).map(([p]) => p);
  if (!dryRun) {
    mkdirSync(join(ROOT, OUT_DIR), { recursive: true });
    for (const p of stale) writeFileSync(join(ROOT, p), files[p]);
  }
  return stale;
}

export const paths = { THEME, BOOK, DOC, OUT_DIR, PAGE, rel: (p) => relative(ROOT, p) };
