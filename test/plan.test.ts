import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson, toPlannedTasks } from "../apps/projects/src/server/plan.ts";

test("extractJson reads a fenced JSON block", () => {
  const reply = 'Here is the plan:\n```json\n{"tasks":[{"title":"Write brief"}]}\n```\nGood luck.';
  assert.deepEqual(extractJson(reply), { tasks: [{ title: "Write brief" }] });
});

test("extractJson reads bare JSON with text around it", () => {
  assert.deepEqual(extractJson('Sure. [{"title":"A"}] Done.'), [{ title: "A" }]);
});

test("extractJson returns null for text without JSON", () => {
  assert.equal(extractJson("I cannot help with that."), null);
});

test("toPlannedTasks turns offsets into dates and cleans fields", () => {
  const out = toPlannedTasks(
    {
      tasks: [
        { title: "  Draft the brief ", phase: "Plan", priority: "high", startOffsetDays: 0, durationDays: 3, notes: "One line." },
        { title: "Review", priority: "urgent", startOffsetDays: 5, durationDays: 0 },
        { title: "" },
        "not an object"
      ]
    },
    "2026-11-30"
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { title: "Draft the brief", phase: "Plan", priority: "high", start: "2026-11-30", end: "2026-12-02", notes: "One line." });
  assert.equal(out[1].priority, "med"); // unknown priority falls back
  assert.equal(out[1].start, "2026-12-05");
  assert.equal(out[1].end, "2026-12-05"); // duration is at least one day
});

test("toPlannedTasks clamps large values and caps the list", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ title: `Task ${i}`, startOffsetDays: 9999, durationDays: 9999 }));
  const out = toPlannedTasks(many, "2026-01-01");
  assert.equal(out.length, 25);
  assert.equal(out[0].start, "2027-01-01"); // offset clamped to 365 days
});
