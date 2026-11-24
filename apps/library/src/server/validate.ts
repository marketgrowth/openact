import { HttpError, dateOrNull, text } from "@openact/core/server";
import {
  DEFAULT_SETTINGS,
  MAX_CHECK,
  MAX_CHECKS,
  MAX_LINKED_SOURCES,
  MAX_SHORT,
  MAX_TERM_NAME,
  MAX_TEXT,
  MAX_TITLE,
  TERM_KINDS,
  cleanUrl,
  type ItemKind,
  type Settings,
  type SourceFields,
  type UpdateFields
} from "../shared/rules.ts";

/* Input checks for the Library. Each one throws a 400 with a plain message that the web app shows. */

const obj = (v: unknown, field: string): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, `Send ${field} as an object.`);
  return v as Record<string, unknown>;
};

const bool = (v: unknown, field: string): boolean => {
  if (typeof v !== "boolean") throw new HttpError(400, `${field} must be true or false.`);
  return v;
};

function ids(v: unknown, field: string, max: number): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.length > 64)) throw new HttpError(400, `${field} must be a list of ids.`);
  const out = [...new Set(v as string[])];
  if (out.length > max) throw new HttpError(400, `${field} can hold ${max} items or fewer.`);
  return out;
}

function url(v: unknown): string {
  const r = cleanUrl(v);
  if ("problem" in r) throw new HttpError(400, r.problem);
  return r.url;
}

export function cleanSourceFields(raw: unknown): SourceFields {
  const b = obj(raw, "the source");
  return {
    title: text(b.title, "Title", { max: MAX_TITLE, required: true }),
    citation: text(b.citation, "Citation", { max: MAX_SHORT }),
    summary: text(b.summary, "Summary", { max: MAX_SHORT }),
    details: text(b.details, "Details", { max: MAX_TEXT }),
    sourceUrl: url(b.sourceUrl),
    lastCheckedDate: dateOrNull(b.lastCheckedDate, "Last checked"),
    termIds: ids(b.termIds, "The list items", 3 * 60)
  };
}

export function cleanUpdateFields(raw: unknown): UpdateFields {
  const b = obj(raw, "the update");
  return {
    title: text(b.title, "Title", { max: MAX_TITLE, required: true }),
    whatChanged: text(b.whatChanged, "What changed", { max: MAX_TEXT }),
    whoAffected: text(b.whoAffected, "Who it affects", { max: MAX_TEXT }),
    action: text(b.action, "What to do", { max: MAX_TEXT }),
    actionDueDate: dateOrNull(b.actionDueDate, "By when"),
    sourceUrl: url(b.sourceUrl),
    publishedDate: dateOrNull(b.publishedDate, "Published date"),
    termIds: ids(b.termIds, "The list items", 3 * 60),
    sourceIds: ids(b.sourceIds, "The sources it changes", MAX_LINKED_SOURCES)
  };
}

export const cleanFields = (kind: ItemKind, raw: unknown) => (kind === "source" ? cleanSourceFields(raw) : cleanUpdateFields(raw));

export function cleanTermName(v: unknown): string {
  return text(v, "Name", { max: MAX_TERM_NAME, required: true });
}

const label = (v: unknown, field: string) => text(v, field, { max: 40, required: true });

/** The whole settings object. Missing keys keep their current value. */
export function cleanSettings(raw: unknown, current: Settings): Settings {
  const b = obj(raw, "the settings");
  const next: Settings = structuredClone(current);
  if (b.title !== undefined) next.title = label(b.title, "Page title");
  if (b.sourcesName !== undefined) next.sourcesName = label(b.sourcesName, "Name for sources");
  if (b.updatesName !== undefined) next.updatesName = label(b.updatesName, "Name for updates");
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
  if (b.fieldLabels !== undefined) {
    const f = obj(b.fieldLabels, "the field labels");
    for (const k of Object.keys(DEFAULT_SETTINGS.fieldLabels) as (keyof Settings["fieldLabels"])[]) {
      if (f[k] !== undefined) next.fieldLabels[k] = label(f[k], "Field label");
    }
  }
  if (b.showLastChecked !== undefined) next.showLastChecked = bool(b.showLastChecked, "Last checked date");
  if (b.notice !== undefined) next.notice = text(b.notice, "Notice", { max: MAX_SHORT });
  if (b.checklist !== undefined) {
    if (!Array.isArray(b.checklist)) throw new HttpError(400, "The review checklist must be a list.");
    const list = b.checklist.map((c) => text(c, "A check", { max: MAX_CHECK })).filter(Boolean);
    if (list.length > MAX_CHECKS) throw new HttpError(400, `The review checklist can hold ${MAX_CHECKS} checks or fewer.`);
    next.checklist = list;
  }
  if (b.newDays !== undefined) {
    if (typeof b.newDays !== "number" || !Number.isInteger(b.newDays) || b.newDays < 1 || b.newDays > 365) {
      throw new HttpError(400, "The \"new\" window must be a whole number of days from 1 to 365.");
    }
    next.newDays = b.newDays;
  }
  if (b.requireSecondReviewer !== undefined) next.requireSecondReviewer = bool(b.requireSecondReviewer, "Require a second reviewer");
  if (b.chatOn !== undefined) next.chatOn = bool(b.chatOn, "Ask");
  if (b.chatIntro !== undefined) next.chatIntro = text(b.chatIntro, "Ask intro", { max: MAX_SHORT });
  return next;
}
