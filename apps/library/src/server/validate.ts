import { HttpError, oneOf, text } from "@openact/core/server";
import {
  EVERY_CHOICES,
  FORMATS,
  MAX_BODY,
  MAX_SHORT,
  MAX_SUGGESTIONS,
  MAX_SUMMARY,
  MAX_TERM_NAME,
  MAX_TERMS_PER_KIND,
  MAX_TITLE,
  TERM_KINDS,
  COMPANY_SETTING_KEYS,
  cleanUrl,
  type ResourceFields,
  type Settings
} from "../shared/rules.ts";

/* Input checks for the Library routes. Each one throws HttpError with a message the web app can show. */

export const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, `Send ${what} as an object.`);
  return v as Record<string, unknown>;
};

export const bool = (v: unknown, field: string): boolean => {
  if (typeof v !== "boolean") throw new HttpError(400, `${field} must be true or false.`);
  return v;
};

export function ids(v: unknown, field: string, max: number): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.length > 64)) throw new HttpError(400, `${field} must be a list of ids.`);
  const out = [...new Set(v as string[])];
  if (out.length > max) throw new HttpError(400, `${field} can hold ${max} items or fewer.`);
  return out;
}

export function url(v: unknown, label = "The link"): string {
  const r = cleanUrl(v, label);
  if ("problem" in r) throw new HttpError(400, r.problem);
  return r.url;
}

/** The fields a manager edits. A title is required, everything else may wait for publish. */
export function cleanFields(raw: unknown): ResourceFields {
  const b = obj(raw, "the resource");
  return {
    format: oneOf(b.format, "Format", FORMATS),
    title: text(b.title, "Title", { max: MAX_TITLE, required: true }),
    summary: text(b.summary, "Summary", { max: MAX_SUMMARY }),
    body: text(b.body, "Text", { max: MAX_BODY }),
    sourceUrl: url(b.sourceUrl),
    imageUrl: url(b.imageUrl, "The image link"),
    siteName: text(b.siteName, "Site name", { max: 120 }),
    featured: b.featured === undefined ? false : bool(b.featured, "Featured"),
    termIds: ids(b.termIds, "The list values", 3 * MAX_TERMS_PER_KIND)
  };
}

export function cleanTermName(v: unknown): string {
  return text(v, "Name", { max: MAX_TERM_NAME, required: true });
}

const label = (v: unknown, field: string) => text(v, field, { max: 40, required: true });

/** The whole settings object. Missing keys keep their current value. A company may set only its own keys. */
export function cleanSettings(raw: unknown, current: Settings, level: "site" | "company" = "site"): Settings {
  const b = { ...obj(raw, "the settings") };
  if (level === "company") {
    for (const k of Object.keys(b)) if (!(COMPANY_SETTING_KEYS as readonly string[]).includes(k)) delete b[k];
  }
  const next: Settings = structuredClone(current);
  if (b.title !== undefined) next.title = label(b.title, "Page title");
  if (b.intro !== undefined) next.intro = text(b.intro, "Line under the title", { max: MAX_SHORT });
  if (b.lists !== undefined) {
    const l = obj(b.lists, "the lists");
    for (const k of TERM_KINDS) {
      if (l[k] === undefined) continue;
      const one = obj(l[k], `the ${k} list`);
      next.lists[k] = {
        label: one.label === undefined ? next.lists[k].label : label(one.label, "List label"),
        on: one.on === undefined ? next.lists[k].on : bool(one.on, "List on")
      };
    }
  }
  if (b.suggestions !== undefined) {
    if (!Array.isArray(b.suggestions)) throw new HttpError(400, "Suggested questions must be a list.");
    const list = b.suggestions.map((q) => text(q, "A suggested question", { max: 120 })).filter(Boolean);
    if (list.length > MAX_SUGGESTIONS) throw new HttpError(400, `Use ${MAX_SUGGESTIONS} suggested questions or fewer.`);
    next.suggestions = list;
  }
  if (b.askOn !== undefined) next.askOn = bool(b.askOn, "Ask");
  if (b.notice !== undefined) next.notice = text(b.notice, "Notice", { max: MAX_SHORT });
  if (b.aiFill !== undefined) next.aiFill = bool(b.aiFill, "Fill in new items with AI");
  if (b.reviewOn !== undefined) next.reviewOn = bool(b.reviewOn, "Review before publish");
  return next;
}

export function cleanEvery(v: unknown): number {
  if (v === undefined) return 60;
  if (typeof v !== "number" || !EVERY_CHOICES.includes(v)) throw new HttpError(400, "Pick how often to check: every hour, day or week.");
  return v;
}
