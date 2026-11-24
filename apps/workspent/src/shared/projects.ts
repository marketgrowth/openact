import { addDays, csvRow, isDate, weekStart } from "./rules.ts";

/*
 * The Projects kind of work: time a person spends on work for a client.
 * Projects come from the Projects app. WorkSpent adds a client, a rate and a budget to each project.
 * A person sends their week. A client approves their part from a link, or a manager approves it.
 * Pure functions and API types. The server and the pages share them.
 */

export const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "PHP"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const ROUNDING = [0, 6, 15] as const;
export const MEMBER_KINDS = ["staff", "freelancer"] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];
export const WEEK_STATUSES = ["sent", "approved", "returned"] as const;
export type WeekStatus = (typeof WEEK_STATUSES)[number];
export const GROUPS = ["client", "project", "person", "task"] as const;
export type GroupBy = (typeof GROUPS)[number];

export const MAX_ENTRY_MINUTES = 24 * 60;
export const MAX_RATE_CENTS = 10_000_000;
export const MAX_REPORT_DAYS = 366;
/** A client approval link works this long. */
export const LINK_DAYS = 14;
/** A budget is near its limit at this share. */
export const BUDGET_WARN = 0.8;
/** The site_settings key for the site default kinds of work. */
export const SITE_KEY = "workspent.kinds";

export const STATUS_TEXT: Record<WeekStatus | "open", string> = {
  open: "Not sent",
  sent: "Sent",
  approved: "Approved",
  returned: "Returned"
};

/** Which kinds of work are on. Without a choice, both are on. */
export interface Kinds {
  projects: boolean;
  shifts: boolean;
}

export function readKinds(json: string | null | undefined): Kinds | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<Kinds>;
    if (typeof v.projects === "boolean" && typeof v.shifts === "boolean") return { projects: v.projects, shifts: v.shifts };
  } catch {
    /* A broken value means no choice. */
  }
  return null;
}

/** The company's choice wins, then the site default, then both on. */
export function effectiveKinds(company: { projects: boolean | null; shifts: boolean | null } | null, site: Kinds | null): Kinds {
  const base = site ?? { projects: true, shifts: true };
  return {
    projects: company?.projects ?? base.projects,
    shifts: company?.shifts ?? base.shifts
  };
}

/** The rate for an hour: the project's, then the client's, then the person's. Null when none is set. */
export function rateFor(project: number | null | undefined, client: number | null | undefined, person: number | null | undefined): number | null {
  for (const r of [project, client, person]) if (typeof r === "number" && r >= 0) return r;
  return null;
}

/** Cents for minutes at a rate for an hour, rounded to the cent. */
export const amountCents = (minutes: number, rateCents: number | null) => (rateCents === null ? 0 : Math.round((minutes * rateCents) / 60));

/** Minutes rounded to the nearest step. Any time above zero stays at least one step. */
export function roundMinutes(minutes: number, step: number): number {
  const m = Math.max(0, Math.round(minutes));
  if (!step || !m) return m;
  return Math.max(step, Math.round(m / step) * step);
}

/** Whole minutes between a timer start and now, at most one day. */
export const timerMinutes = (startMs: number, nowMs: number) => Math.min(MAX_ENTRY_MINUTES, Math.max(0, Math.floor((nowMs - startMs) / 60_000)));

/** "7:45" for minutes. */
export function clockText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** "7.8 h" for minutes, one decimal. */
export const hoursOne = (minutes: number) => `${(Math.round(minutes / 6) / 10).toFixed(1)} h`;

/** "$1,215.00" for cents. */
export function moneyText(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Cents from a typed amount such as "75" or "75.50". Null for empty. Throws text for a bad amount. */
export function centsFrom(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error("Enter a rate of 0 or more, such as 75 or 75.50.");
  const cents = Math.round(n * 100);
  if (cents > MAX_RATE_CENTS) throw new Error("This rate is too high.");
  return cents;
}

/** Minutes from "1:30", "1.5" or "90m". Null when it cannot read it. */
export function minutesFrom(v: string): number | null {
  const s = v.trim().toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,2}):([0-5]\d)$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^(\d{1,3})\s*m(in)?$/))) return Number(m[1]);
  if ((m = s.match(/^(\d{1,2}(\.\d{1,2})?)\s*h?$/))) return Math.round(Number(m[1]) * 60);
  return null;
}

/** The seven dates of the week that holds a date, Sunday first. */
export const weekDates = (date: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i));

/** A date range that the reports accept: both dates real, in order, and at most a year. */
export function rangeProblem(from: unknown, to: unknown): string | null {
  if (!isDate(from) || !isDate(to)) return "Give the dates as YYYY-MM-DD.";
  if (to < from) return "The end date must not be before the start date.";
  if (Date.parse(to) - Date.parse(from) > MAX_REPORT_DAYS * 86_400_000) return `Pick ${MAX_REPORT_DAYS} days or fewer.`;
  return null;
}

/* Reports ---------------------------------------------------------- */

/** One entry, as the reports read it. */
export interface ReportEntry {
  date: string;
  personId: string;
  personName: string;
  clientId: string | null;
  clientName: string;
  projectId: string;
  projectName: string;
  taskName: string;
  note: string;
  minutes: number;
  billable: boolean;
  rateCents: number | null;
  status: WeekStatus | "open";
}

export interface ReportGroup {
  key: string;
  label: string;
  minutes: number;
  billableMinutes: number;
  cents: number;
  rows: Array<{
    key: string;
    label: string;
    minutes: number;
    billableMinutes: number;
    cents: number;
  }>;
}

export interface ReportTotals {
  minutes: number;
  billableMinutes: number;
  cents: number;
}

const keyLabel = (e: ReportEntry, by: GroupBy): [string, string] => {
  if (by === "client") return [e.clientId ?? "", e.clientName || "No client"];
  if (by === "project") return [e.projectId, e.projectName];
  if (by === "person") return [e.personId, e.personName];
  return [`${e.projectId}:${e.taskName}`, e.taskName ? `${e.projectName}: ${e.taskName}` : `${e.projectName}: no task`];
};

/** The amount of one entry: billable minutes at its rate. */
export const entryCents = (e: Pick<ReportEntry, "billable" | "minutes" | "rateCents">) => (e.billable ? amountCents(e.minutes, e.rateCents) : 0);

/** Groups entries two levels deep: by `by`, then by project (or by client when `by` is project). Largest first. */
export function groupReport(entries: ReportEntry[], by: GroupBy): { groups: ReportGroup[]; totals: ReportTotals } {
  const inner: GroupBy = by === "project" ? "client" : by === "task" ? "person" : "project";
  const groups = new Map<string, ReportGroup>();
  const totals: ReportTotals = { minutes: 0, billableMinutes: 0, cents: 0 };
  for (const e of entries) {
    const [k, label] = keyLabel(e, by);
    const [rk, rlabel] = keyLabel(e, inner);
    const g = groups.get(k) ?? {
      key: k,
      label,
      minutes: 0,
      billableMinutes: 0,
      cents: 0,
      rows: []
    };
    let row = g.rows.find((r) => r.key === rk);
    if (!row)
      g.rows.push(
        (row = {
          key: rk,
          label: rlabel,
          minutes: 0,
          billableMinutes: 0,
          cents: 0
        })
      );
    const bill = e.billable ? e.minutes : 0;
    const cents = entryCents(e);
    for (const t of [g, row, totals]) {
      t.minutes += e.minutes;
      t.billableMinutes += bill;
      t.cents += cents;
    }
    groups.set(k, g);
  }
  const out = [...groups.values()].sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label));
  for (const g of out) g.rows.sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label));
  return { groups: out, totals };
}

export const ENTRY_CSV_HEADER = ["Date", "Person", "Client", "Project", "Task", "Note", "Minutes", "Hours", "Billable", "Rate", "Amount", "Currency", "Status"];

export function entryCsv(entries: ReportEntry[], currency: string): string {
  const lines = [csvRow(ENTRY_CSV_HEADER)];
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.personName.localeCompare(b.personName))) {
    lines.push(
      csvRow([
        e.date,
        e.personName,
        e.clientName,
        e.projectName,
        e.taskName,
        e.note,
        e.minutes,
        (e.minutes / 60).toFixed(2),
        e.billable ? "Yes" : "No",
        e.rateCents === null ? "" : (e.rateCents / 100).toFixed(2),
        (entryCents(e) / 100).toFixed(2),
        currency,
        STATUS_TEXT[e.status]
      ])
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/* API types -------------------------------------------------------- */

export interface WorkSettings extends Kinds {
  currency: string;
  roundingMinutes: number;
  /** True when the company has made no choice, so the site default applies. */
  fromSite: boolean;
  site: Kinds;
  /** True for the site owner, who sets the site default. */
  canSetSite: boolean;
}

export interface ClientInfo {
  id: string;
  name: string;
  approverName: string;
  /** Only for people who set up WorkSpent. */
  approverEmail: string;
  hasApprover: boolean;
  rateCents: number | null;
  isArchived: boolean;
}

export interface ProjectInfo {
  id: string;
  name: string;
  color: string;
  clientId: string | null;
  rateCents: number | null;
  budgetMinutes: number | null;
  isBillable: boolean;
  isTracked: boolean;
  /** Minutes logged on the project, all time. */
  usedMinutes: number;
}

export interface TaskInfo {
  id: string;
  title: string;
  done: boolean;
}

export interface MemberInfo {
  userId: string;
  name: string;
  email: string;
  role: string;
  kind: MemberKind;
  rateCents: number | null;
  weeklyMinutes: number | null;
}

export interface EntryInfo {
  id: string;
  userId: string;
  projectId: string;
  projectName: string;
  taskId: string | null;
  taskName: string;
  clientId: string | null;
  clientName: string;
  date: string;
  minutes: number;
  /** Set while the timer runs. */
  timerStartedAt: string | null;
  note: string;
  billable: boolean;
  rateCents: number | null;
  status: WeekStatus | "open";
}

export interface WeekPart {
  clientId: string | null;
  clientName: string;
  minutes: number;
  cents: number;
  status: WeekStatus | "open";
  note: string;
  decidedBy: string;
  decidedAt: string | null;
  sentAt: string | null;
  /** True when the client has an approver email, so a link can go to them. */
  hasApprover: boolean;
}

export interface WeekPerson {
  userId: string;
  name: string;
  kind: MemberKind;
  minutes: number;
  /** The status of the whole week: the least advanced part. */
  status: WeekStatus | "open" | "empty";
}

export interface TimeLogData {
  week: string;
  dates: string[];
  currency: string;
  userId: string;
  personName: string;
  canManage: boolean;
  isSelf: boolean;
  people: WeekPerson[];
  entries: EntryInfo[];
  parts: WeekPart[];
}

export interface MyProjectTime {
  currency: string;
  roundingMinutes: number;
  week: string;
  running: EntryInfo | null;
  entries: EntryInfo[];
  parts: WeekPart[];
  weeklyMinutes: number | null;
  projects: ProjectInfo[];
  clients: ClientInfo[];
  /** False when the Projects app is off for the company. */
  projectsApp: boolean;
}

export interface ReportData {
  from: string;
  to: string;
  groupBy: GroupBy;
  currency: string;
  groups: ReportGroup[];
  totals: ReportTotals;
  budgetsNearLimit: number;
}

export interface ApprovalView {
  companyName: string;
  personName: string;
  clientName: string;
  week: string;
  currency: string;
  status: WeekStatus;
  entries: Array<{
    date: string;
    projectName: string;
    taskName: string;
    note: string;
    minutes: number;
    cents: number;
  }>;
  minutes: number;
  cents: number;
}

/** The status of a week from its parts: returned first, then not sent, then sent, then approved. */
export function weekStatus(parts: Array<{ status: WeekStatus | "open" }>): WeekStatus | "open" | "empty" {
  if (!parts.length) return "empty";
  for (const s of ["returned", "open", "sent"] as const) if (parts.some((p) => p.status === s)) return s;
  return "approved";
}
