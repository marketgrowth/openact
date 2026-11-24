/*
 * The Library's shared types, defaults and rules, for the server and the web app.
 * The app holds no brand words. Each site sets its own words in the brand settings.
 */

export const API = "/api/apps/library";
export const HOME = "/a/library";

export type ItemKind = "source" | "update";
export const ITEM_KINDS: readonly ItemKind[] = ["source", "update"];
/** The path part for each kind, in the API and in the web app: /a/library/sources/<id>. */
export const KIND_PATH: Record<ItemKind, "sources" | "updates"> = { source: "sources", update: "updates" };
export const kindFromPath = (p: string | undefined): ItemKind | null => (p === "sources" ? "source" : p === "updates" ? "update" : null);

export type TermKind = "category" | "audience" | "topic";
export const TERM_KINDS: readonly TermKind[] = ["category", "audience", "topic"];

export type Status = "draft" | "in_review" | "published" | "archived";
export const STATUSES: readonly Status[] = ["draft", "in_review", "published", "archived"];
export const STATUS_LABEL: Record<Status, string> = { draft: "Draft", in_review: "In review", published: "Published", archived: "Archived" };

export type ReviewAction = "submit" | "return" | "publish" | "archive" | "restore";
export const REVIEW_ACTIONS: readonly ReviewAction[] = ["submit", "return", "publish", "archive", "restore"];

/* Limits. */
export const MAX_TITLE = 200;
export const MAX_SHORT = 300;
export const MAX_TEXT = 4000;
export const MAX_URL = 600;
export const MAX_TERMS_PER_KIND = 60;
export const MAX_TERM_NAME = 60;
export const MAX_CHECKS = 8;
export const MAX_CHECK = 160;
export const MAX_ITEMS = 1000;
export const MAX_LINKED_SOURCES = 20;
export const MAX_QUESTION = 1000;
export const MAX_HISTORY = 6;
/** How many library items go to the model with each question. */
export const ASK_ITEMS = 6;

export interface Term {
  id: string;
  kind: TermKind;
  name: string;
  sortOrder: number;
  isHidden: boolean;
}

export interface ListSetting {
  /** The word readers see for the list, such as "Facility type". */
  label: string;
  /** Off hides the list's filter and tags. The data stays. */
  on: boolean;
}

/** Every word and switch that a site can set. */
export interface Settings {
  title: string;
  sourcesName: string;
  updatesName: string;
  lists: Record<TermKind, ListSetting>;
  fieldLabels: { whatChanged: string; whoAffected: string; action: string; dueDate: string };
  showLastChecked: boolean;
  notice: string;
  checklist: string[];
  newDays: number;
  requireSecondReviewer: boolean;
  /** Ask: an AI chat that answers from the published items only. Off hides it. */
  chatOn: boolean;
  /** The line under the Ask box. */
  chatIntro: string;
}

export const DEFAULT_SETTINGS: Settings = {
  title: "Library",
  sourcesName: "Sources",
  updatesName: "Updates",
  lists: {
    category: { label: "Category", on: true },
    audience: { label: "Audience", on: true },
    topic: { label: "Topic", on: true }
  },
  fieldLabels: { whatChanged: "What changed", whoAffected: "Who it affects", action: "What to do", dueDate: "By when" },
  showLastChecked: true,
  notice: "",
  checklist: ["I read the official source, and the summary matches it.", "The dates and numbers match the source."],
  newDays: 30,
  requireSecondReviewer: false,
  chatOn: true,
  chatIntro: "Ask a question. Answers come only from the published items, with a link to each one."
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

export interface SourceFields {
  title: string;
  citation: string;
  summary: string;
  details: string;
  sourceUrl: string;
  lastCheckedDate: string | null;
  termIds: string[];
}

export interface UpdateFields {
  title: string;
  whatChanged: string;
  whoAffected: string;
  action: string;
  actionDueDate: string | null;
  sourceUrl: string;
  publishedDate: string | null;
  termIds: string[];
  sourceIds: string[];
}

export type ItemFields<K extends ItemKind> = K extends "source" ? SourceFields : UpdateFields;

export const EMPTY_SOURCE: SourceFields = { title: "", citation: "", summary: "", details: "", sourceUrl: "", lastCheckedDate: null, termIds: [] };
export const EMPTY_UPDATE: UpdateFields = {
  title: "",
  whatChanged: "",
  whoAffected: "",
  action: "",
  actionDueDate: null,
  sourceUrl: "",
  publishedDate: null,
  termIds: [],
  sourceIds: []
};

/** A published source, as readers see it. */
export interface PublishedSource extends SourceFields {
  id: string;
  version: number;
  publishedAt: string;
  /** The newest published date of an update that changes this source, inside the "new" window. Null when none. */
  updatedDate: string | null;
}

/** A published update, as readers see it. */
export interface PublishedUpdate extends UpdateFields {
  id: string;
  version: number;
  publishedAt: string;
  isNew: boolean;
}

/** What the read pages need first. */
export interface LibraryConfig {
  settings: Settings;
  /** Visible list items of the lists that are on. */
  terms: Term[];
  canManage: boolean;
  /** Published updates inside the "new" window. */
  newCount: number;
  /** True when Ask is on and this person has library.ask. */
  canAsk: boolean;
  /** Whose AI answers: the person's own key, the company key, or the site default. Null when canAsk is false. */
  ai: AiChoice | null;
}

export interface AiChoice {
  provider: string;
  model: string;
  source: "user" | "company" | "deploy";
}

/** One turn of an Ask conversation, as the web app sends it back with the next question. */
export interface AskTurn {
  role: "user" | "assistant";
  content: string;
}

/** A library item that an answer used. n is the number in the answer, such as [2]. */
export interface AskCitation {
  n: number;
  kind: ItemKind;
  id: string;
  title: string;
  sourceUrl: string;
}

export interface AskAnswer {
  answer: string;
  /** The items the answer cites, in the order of their numbers. */
  citations: AskCitation[];
  /** Items that matched the question but the answer did not cite. */
  related: AskCitation[];
  /** Null when no item matched, so no model was asked. */
  ai: AiChoice | null;
}

export interface SourceDetail {
  item: PublishedSource;
  updates: { id: string; title: string; publishedDate: string | null }[];
}
export interface UpdateDetail {
  item: PublishedUpdate;
  sources: { id: string; title: string }[];
}

/** One row of the Manage list. */
export interface ManageRow {
  kind: ItemKind;
  id: string;
  title: string;
  status: Status;
  /** The newest published version, or null when it was never published. */
  liveVersion: number | null;
  updatedAt: string;
  updatedByName: string | null;
  reviewNote: string;
}

export interface ManageItem<K extends ItemKind = ItemKind> {
  kind: K;
  id: string;
  status: Status;
  fields: ItemFields<K>;
  liveVersion: number | null;
  reviewNote: string;
  submittedByName: string | null;
  updatedByName: string | null;
  updatedAt: string;
  history: { version: number; publishedAt: string; publishedByName: string | null }[];
  /** True when this person may publish now. False with a reason in publishBlock. */
  canPublish: boolean;
  publishBlock: string | null;
}

/** The Manage list, the settings and every list item, hidden ones too. */
export interface ManageState {
  rows: ManageRow[];
  settings: Settings;
  terms: Term[];
}

/* Rules that the server and the web app share. */

/** A web address for an official source: https only. Empty is allowed for a draft. */
export function cleanUrl(raw: unknown): { url: string } | { problem: string } {
  if (raw === undefined || raw === null) return { url: "" };
  if (typeof raw !== "string") return { problem: "The source link must be text." };
  const s = raw.trim();
  if (!s) return { url: "" };
  if (s.length > MAX_URL) return { problem: `The source link is too long. Use ${MAX_URL} characters or fewer.` };
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return { problem: "The source link is not a web address. Use an address like https://www.example.gov/page." };
  }
  if (u.protocol !== "https:") return { problem: "The source link must start with https://." };
  if (u.username || u.password) return { problem: "The source link must not hold a user name or password." };
  return { url: u.toString() };
}

/** The site name of a link, such as dhcs.ca.gov, for the cards. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The first day inside the "new" window, as YYYY-MM-DD. */
export function newSince(today: string, days: number): string {
  const t = Date.parse(today + "T00:00:00Z") - Math.max(0, days - 1) * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** True when a published item matches a search: every word must be in its text. Case does not matter. */
export function matches(text: string, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const t = text.toLowerCase();
  return words.every((w) => t.includes(w));
}

export const sourceText = (s: SourceFields) => [s.title, s.citation, s.summary, s.details].join(" ");
export const updateText = (u: UpdateFields) => [u.title, u.whatChanged, u.whoAffected, u.action].join(" ");

/** True when an item has at least one term of each kind in `want`. An empty list for a kind means any. */
export function hasTerms(termIds: readonly string[], want: Partial<Record<TermKind, readonly string[]>>): boolean {
  for (const k of TERM_KINDS) {
    const ids = want[k];
    if (ids && ids.length && !ids.some((id) => termIds.includes(id))) return false;
  }
  return true;
}

/** What is missing before an item can be published, or null when nothing is. */
export function publishProblem(kind: ItemKind, f: SourceFields | UpdateFields): string | null {
  if (!f.title.trim()) return "Add a title before you publish.";
  if (!f.sourceUrl) return "Add the official source link before you publish.";
  if (kind === "update" && !(f as UpdateFields).whatChanged.trim()) return "Say what changed before you publish.";
  if (kind === "source" && !(f as SourceFields).summary.trim()) return "Add a summary before you publish.";
  return null;
}
