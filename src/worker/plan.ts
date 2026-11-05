// Pure helpers for the AI planner. No runtime imports, so Node can test this file directly.
import type { PlannedTask, Priority } from "../shared/types";

const PRIORITY_IDS: Priority[] = ["high", "med", "low"];

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

/** Finds the first JSON object or array in a model reply. */
export function extractJson(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], reply];
  for (const cand of candidates) {
    if (!cand) continue;
    const starts = [cand.indexOf("{"), cand.indexOf("[")].filter((i) => i >= 0);
    if (!starts.length) continue;
    const start = Math.min(...starts);
    const end = Math.max(cand.lastIndexOf("}"), cand.lastIndexOf("]"));
    if (end <= start) continue;
    try {
      return JSON.parse(cand.slice(start, end + 1));
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Turns the model's plan into safe task drafts with real dates. */
export function toPlannedTasks(raw: unknown, start: string): PlannedTask[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { tasks?: unknown }).tasks) ? (raw as { tasks: unknown[] }).tasks : [];
  const out: PlannedTask[] = [];
  for (const item of list.slice(0, 25)) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    const title = typeof t.title === "string" ? t.title.trim().slice(0, 140) : "";
    if (!title) continue;
    const offset = Math.max(0, Math.min(365, Math.round(Number(t.startOffsetDays ?? t.start_offset_days ?? 0)) || 0));
    const duration = Math.max(1, Math.min(120, Math.round(Number(t.durationDays ?? t.duration_days ?? 1)) || 1));
    const priority: Priority = PRIORITY_IDS.includes(t.priority as Priority) ? (t.priority as Priority) : "med";
    out.push({
      title,
      phase: typeof t.phase === "string" ? t.phase.trim().slice(0, 60) : "",
      priority,
      start: addDays(start, offset),
      end: addDays(start, offset + duration - 1),
      notes: typeof t.notes === "string" ? t.notes.trim().slice(0, 1000) : ""
    });
  }
  return out;
}
