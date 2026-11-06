// Dates are "YYYY-MM-DD" strings. Math runs on UTC day numbers, so time zones and DST do not shift them.

export const DAY = 86400000;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

export function dn(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}
export const ds = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
export const dow = (n: number) => new Date(n * DAY).getUTCDay();

/** Today in the viewer's own time zone. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtShort(s: string): string {
  const d = new Date(dn(s) * DAY);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function fmtRange(a: string | null, b: string | null): string {
  if (!a) return "No dates";
  if (!b || a === b) return fmtShort(a);
  const A = new Date(dn(a) * DAY);
  const B = new Date(dn(b) * DAY);
  if (A.getUTCMonth() === B.getUTCMonth() && A.getUTCFullYear() === B.getUTCFullYear()) {
    return `${MONTHS[A.getUTCMonth()]} ${A.getUTCDate()}–${B.getUTCDate()}`;
  }
  return `${fmtShort(a)} – ${fmtShort(b)}`;
}

/** Monday to Friday, both ends included. */
export function workDays(a: string, b: string): number {
  let n = 0;
  for (let i = dn(a), e = dn(b); i <= e; i++) {
    const w = dow(i);
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

export function isoWeek(n: number): number {
  const thu = n - ((dow(n) + 6) % 7) + 3;
  const y = new Date(thu * DAY).getUTCFullYear();
  const jan4 = Math.round(Date.UTC(y, 0, 4) / DAY);
  const firstThu = jan4 - ((dow(jan4) + 6) % 7) + 3;
  return 1 + Math.round((thu - firstThu) / 7);
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()} at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
