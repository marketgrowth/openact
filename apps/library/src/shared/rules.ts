/*
 * The Library's shared types, defaults and rules, for the server and the web app.
 * The app holds no brand words and no fixed workflow. Each site sets its own words and lists.
 */

export const API = "/api/apps/library";
export const HOME = "/a/library";

/* Resources */

export type Format = "document" | "link" | "video" | "article";
export const FORMATS: readonly Format[] = ["document", "link", "video", "article"];
export const FORMAT_LABEL: Record<Format, string> = { document: "Document", link: "Link", video: "Video", article: "Article" };
export const FORMAT_PLURAL: Record<Format, string> = { document: "Documents", link: "Links", video: "Videos", article: "Articles" };

export type Status = "draft" | "published" | "archived";
export const STATUSES: readonly Status[] = ["draft", "published", "archived"];
export const STATUS_LABEL: Record<Status, string> = { draft: "Draft", published: "Published", archived: "Archived" };

/** Who added a resource. Everything but "person" lands in To review, unless its automation publishes. */
export type Origin = "person" | "feed" | "video_channel" | "webhook" | "agent";
export const ORIGIN_LABEL: Record<Origin, string> = { person: "Person", feed: "Feed", video_channel: "Video channel", webhook: "Webhook", agent: "AI agent" };

/** The tabs of the manage list. "review" holds drafts that automations or agents added. */
export type ManageTab = "review" | "drafts" | "published" | "archived";
export const MANAGE_TABS: readonly ManageTab[] = ["review", "drafts", "published", "archived"];
export const MANAGE_TAB_LABEL: Record<ManageTab, string> = { review: "To review", drafts: "Drafts", published: "Published", archived: "Archived" };

export type TermKind = "type" | "topic" | "audience";
export const TERM_KINDS: readonly TermKind[] = ["type", "topic", "audience"];

/* Limits */
export const MAX_TITLE = 200;
export const MAX_SHORT = 300;
export const MAX_SUMMARY = 1000;
export const MAX_BODY = 40000;
export const MAX_URL = 800;
export const MAX_TERMS_PER_KIND = 60;
export const MAX_TERM_NAME = 60;
export const MAX_RESOURCES = 5000;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_QUESTION = 1000;
export const MAX_HISTORY = 6;
export const MAX_SUGGESTIONS = 3;
export const MAX_AUTOMATIONS = 20;
/** New entries one automation may add in one run. */
export const MAX_ENTRIES_PER_RUN = 10;
/** Webhook calls one key may make in one hour. */
export const WEBHOOK_PER_HOUR = 60;
/** An automation pauses after this many failed runs in a row. */
export const PAUSE_AFTER_FAILS = 3;
export const EVERY_CHOICES: readonly number[] = [60, 1440, 10080];
export const EVERY_LABEL: Record<number, string> = { 60: "Every hour", 1440: "Every day", 10080: "Every week" };

/* Ask */
/** Words in one chunk of the Ask index. */
export const CHUNK_WORDS = 300;
/** Chunks of one resource, at most. Longer text is cut. */
export const MAX_CHUNKS = 40;
/** Chunks that go to the model with each question, and the resources they may come from. */
export const ASK_CHUNKS = 8;
export const ASK_RESOURCES = 6;

/* Lists and settings */

export interface Term {
  id: string;
  kind: TermKind;
  name: string;
  sortOrder: number;
  /** A hidden value stays on the resources that use it, but readers cannot filter by it. */
  isHidden: boolean;
}

export interface ListSetting {
  label: string;
  on: boolean;
}

export interface Settings {
  /** The page title, such as "Resources". */
  title: string;
  /** One line under the title. */
  intro: string;
  lists: Record<TermKind, ListSetting>;
  /** Up to three questions under the Ask box. */
  suggestions: string[];
  askOn: boolean;
  /** A line under each answer, such as "We give guidance, not legal advice." */
  notice: string;
  /** Write the summary and pick the type and topics of new resources with AI. */
  aiFill: boolean;
  /** A second manager must publish each resource that a person adds. */
  reviewOn: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  title: "Library",
  intro: "",
  lists: { type: { label: "Type", on: true }, topic: { label: "Topic", on: true }, audience: { label: "Audience", on: true } },
  suggestions: [],
  askOn: true,
  notice: "",
  aiFill: false,
  reviewOn: false
};
export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/** What a manager can edit on a resource. */
export interface ResourceFields {
  format: Format;
  title: string;
  summary: string;
  /** The article text, or notes for other formats. Plain text with blank lines between paragraphs. */
  body: string;
  sourceUrl: string;
  imageUrl: string;
  siteName: string;
  featured: boolean;
  termIds: string[];
}

export const EMPTY_FIELDS: ResourceFields = { format: "link", title: "", summary: "", body: "", sourceUrl: "", imageUrl: "", siteName: "", featured: false, termIds: [] };

export interface Resource extends ResourceFields {
  id: string;
  status: Status;
  origin: Origin;
  automationName: string;
  videoProvider: "" | "youtube" | "vimeo" | "upload";
  videoRef: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  hasFile: boolean;
  publishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiChoice {
  provider: string;
  model: string;
  /** "partner": the partner's AI for a client company. "none": the company must add its own AI key first. */
  source: "user" | "company" | "partner" | "deploy" | "none";
}

export interface LibraryConfig {
  settings: Settings;
  /** The values of the lists that are on, hidden ones included (they still show as tags). */
  terms: Term[];
  canManage: boolean;
  canAsk: boolean;
  ai: AiChoice | null;
  /** Drafts from automations that wait for a manager. Zero for readers. */
  toReview: number;
}

export interface ResourceDetail {
  item: Resource;
  related: Resource[];
}

export interface ManageCounts {
  review: number;
  drafts: number;
  published: number;
  archived: number;
}

export interface ManageState {
  settings: Settings;
  terms: Term[];
  counts: ManageCounts;
}

/** What the server reads from a link before the manager saves it. */
export interface LinkPreview {
  format: Format;
  title: string;
  summary: string;
  imageUrl: string;
  siteName: string;
  sourceUrl: string;
  /** Text of the page, for the Ask index. Never shown. */
  text?: string;
  /** Type and topic ids that AI suggests, when AI fill is on. */
  termIds: string[];
  aiFilled: boolean;
}

/* Automations */

export type AutomationKind = "feed" | "video_channel" | "webhook";
export const AUTOMATION_KINDS: readonly AutomationKind[] = ["feed", "video_channel", "webhook"];
export const AUTOMATION_LABEL: Record<AutomationKind, string> = { feed: "Feed or blog", video_channel: "Video channel", webhook: "Webhook" };

export interface Automation {
  id: string;
  kind: AutomationKind;
  name: string;
  /** What the manager typed: a feed, a blog or a channel address. Empty for a webhook. */
  url: string;
  /** The feed the server found and reads. */
  feedUrl: string;
  keyLast4: string;
  everyMinutes: number;
  termIds: string[];
  autoPublish: boolean;
  paused: boolean;
  failCount: number;
  lastRunAt: string | null;
  lastError: string;
  lastNote: string;
}

export interface Run {
  id: string;
  automationId: string;
  automationName: string;
  ranAt: string;
  addedCount: number;
  published: boolean;
  note: string;
  error: string;
}

export interface FeedEntry {
  url: string;
  title: string;
  summary: string;
  date: string | null;
  imageUrl: string;
}

export interface FeedPreview {
  feedUrl: string;
  feedTitle: string;
  entries: FeedEntry[];
}

/* Ask: AG-UI custom events. */

export interface AskCitation {
  n: number;
  id: string;
  title: string;
  format: Format;
  sourceUrl: string;
}

/** CUSTOM event "library.searched": what the search found, for the step line. */
export interface AskSearched {
  searched: number;
  read: number;
}

/** CUSTOM event "library.citations": the resources the answer cites, and others that may help. */
export interface AskCitations {
  citations: AskCitation[];
  related: AskCitation[];
  ai: AiChoice | null;
}

export const ASK_EVENT = { searched: "library.searched", citations: "library.citations" } as const;

/* Rules */

/** A web address: https only, no user name or password. Empty is allowed. */
export function cleanUrl(raw: unknown, label = "The link"): { url: string } | { problem: string } {
  if (raw === undefined || raw === null) return { url: "" };
  if (typeof raw !== "string") return { problem: `${label} must be text.` };
  const s = raw.trim();
  if (!s) return { url: "" };
  if (s.length > MAX_URL) return { problem: `${label} is too long. Use ${MAX_URL} characters or fewer.` };
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return { problem: `${label} is not a web address. Use an address like https://www.example.com/page.` };
  }
  if (u.protocol !== "https:") return { problem: `${label} must start with https://.` };
  if (u.username || u.password) return { problem: `${label} must not hold a user name or password.` };
  return { url: u.toString() };
}

/** The site name of a link, such as example.com, for the cards. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A YouTube or Vimeo video in a link, or null. */
export function videoOf(url: string): { provider: "youtube" | "vimeo"; ref: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m)\./, "");
  const yt = /^[A-Za-z0-9_-]{11}$/;
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0] ?? "";
    return yt.test(id) ? { provider: "youtube", ref: id } : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = u.searchParams.get("v");
    if (v && yt.test(v)) return { provider: "youtube", ref: v };
    const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
    return m ? { provider: "youtube", ref: m[1]! } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/\/(?:video\/)?(\d{5,12})(?:\/|$)/);
    return m ? { provider: "vimeo", ref: m[1]! } : null;
  }
  return null;
}

/** The player address for a linked video. */
export function embedUrl(provider: string, ref: string): string {
  if (provider === "youtube") return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(ref)}`;
  if (provider === "vimeo") return `https://player.vimeo.com/video/${encodeURIComponent(ref)}`;
  return "";
}

/** True when a resource matches a search: every word must be in its text. Case does not matter. */
export function matches(text: string, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const t = text.toLowerCase();
  return words.every((w) => t.includes(w));
}

/** True when a resource has at least one term of each kind in `want`. An empty list for a kind means any. */
export function hasTerms(termIds: readonly string[], want: Partial<Record<TermKind, readonly string[]>>): boolean {
  for (const k of TERM_KINDS) {
    const ids = want[k];
    if (ids && ids.length && !ids.some((id) => termIds.includes(id))) return false;
  }
  return true;
}

/** What is missing before a resource can be published, or null when nothing is. */
export function publishProblem(r: Pick<Resource, "format" | "title" | "body" | "sourceUrl" | "hasFile">): string | null {
  if (!r.title.trim()) return "Add a title before you publish.";
  if (r.format === "article" && !r.body.trim()) return "Write the article before you publish.";
  if (r.format === "document" && !r.hasFile && !r.sourceUrl) return "Upload the file, or add a link to it, before you publish.";
  if ((r.format === "link" || r.format === "video") && !r.sourceUrl && !r.hasFile) return "Add the link before you publish.";
  return null;
}

/** File size for people: 220 KB, 4.1 MB. */
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Cuts text into chunks of about CHUNK_WORDS words for the Ask index. */
export function chunksOf(text: string, size = CHUNK_WORDS, max = MAX_CHUNKS): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length && out.length < max; i += size) out.push(words.slice(i, i + size).join(" "));
  return out;
}
