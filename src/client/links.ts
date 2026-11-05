/*
 * Finds web addresses in plain text, so the app can show them as links.
 * Only http and https links. Pure module, so Node can unit test it.
 */

export type Segment = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?'"]+$/;

/** A safe href for a found address, or null. */
export function safeHref(raw: string): string | null {
  const withScheme = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Drops punctuation that ends a sentence, and a closing bracket with no opening one in the address. */
function trimEnd(s: string): string {
  let out = s.replace(TRAILING, "");
  while (out.endsWith(")") && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0)) out = out.slice(0, -1).replace(TRAILING, "");
  return out;
}

export function splitLinks(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const raw = trimEnd(m[0]);
    const href = safeHref(raw);
    if (!href) continue;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    out.push({ kind: "link", text: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** The links in a text, without repeats. */
export function findLinks(text: string): Array<{ text: string; href: string }> {
  const seen = new Set<string>();
  const out: Array<{ text: string; href: string }> = [];
  for (const s of splitLinks(text)) {
    if (s.kind === "link" && !seen.has(s.href)) {
      seen.add(s.href);
      out.push({ text: s.text, href: s.href });
    }
  }
  return out;
}

/** A short label for a link: the site name and the start of the path. */
export function linkLabel(href: string): string {
  const u = new URL(href);
  const path = u.pathname === "/" ? "" : u.pathname;
  const label = `${u.hostname.replace(/^www\./, "")}${path}`;
  return label.length > 60 ? `${label.slice(0, 57)}…` : label;
}
