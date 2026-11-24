import { cn } from "@openact/ui/lib/utils";
import { bandOf, scheduledMinutes, type Band, type ShiftInfo } from "../shared/schedule";
import { durationText } from "../shared/rules";
import { timeText } from "./lib";

/* Small shared pieces of the schedule views. Class names stay literal, so Tailwind finds them. */

export const BAND_CHIP: Record<Band, string> = {
  day: "border-shift-day/50 bg-shift-day/15",
  evening: "border-shift-evening/50 bg-shift-evening/15",
  night: "border-shift-night/50 bg-shift-night/15"
};
export const BAND_DOT: Record<Band, string> = { day: "bg-shift-day", evening: "bg-shift-evening", night: "bg-shift-night" };
export const BAND_BAR: Record<Band, string> = {
  day: "border-shift-day/60 bg-shift-day/20",
  evening: "border-shift-evening/60 bg-shift-evening/20",
  night: "border-shift-night/60 bg-shift-night/20"
};

/** "7:00 AM to 3:30 PM". */
export const rangeText = (s: { startsAt: string; endsAt: string }, tz: string) => `${timeText(s.startsAt, tz)} to ${timeText(s.endsAt, tz)}`;

export function statusWord(s: ShiftInfo): string | null {
  if (s.status === "draft") return "Draft";
  if (s.status === "changed") return "Changed";
  if (s.status === "deleted") return "Deleted";
  return null;
}

/** One shift as a button: the time, the hours and its status. Open shifts and unpublished shifts have a dashed edge. */
export function ShiftChip({ shift, tz, onClick, label, compact }: { shift: ShiftInfo; tz: string; onClick: () => void; label?: string; compact?: boolean }) {
  const band = bandOf(shift.startsAt, tz);
  const open = !shift.personId;
  const word = statusWord(shift);
  return (
    <button
      type="button"
      onClick={onClick}
      data-shift={shift.id}
      className={cn(
        "w-full rounded-md border px-2 py-1.5 text-left text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        open ? "border-dashed border-warn-border bg-warn text-warn-foreground" : BAND_CHIP[band],
        !open && shift.status !== "published" && "border-[1.5px] border-dashed bg-card",
        shift.status === "deleted" && "opacity-60"
      )}
    >
      {label && <span className="block truncate text-xs font-semibold">{label}</span>}
      <span className={cn("block text-xs tabular-nums", !label && "font-semibold", shift.status === "deleted" && "line-through")}>{rangeText(shift, tz)}</span>
      {!compact && (
        <span className="block text-[11px] text-muted-foreground">
          {open ? "Open shift · Assign" : [word, durationText(scheduledMinutes(shift))].filter(Boolean).join(" · ")}
        </span>
      )}
    </button>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-shift-day/50 bg-shift-day/15" aria-hidden="true" />
        Day (starts 5 AM to 1 PM)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-shift-evening/50 bg-shift-evening/15" aria-hidden="true" />
        Evening (1 PM to 9 PM)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-shift-night/50 bg-shift-night/15" aria-hidden="true" />
        Night (9 PM to 5 AM)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-sm border-[1.5px] border-dashed border-muted-foreground bg-card" aria-hidden="true" />
        Not published
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-dashed border-warn-border bg-warn" aria-hidden="true" />
        Open shift
      </span>
    </div>
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
