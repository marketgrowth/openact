import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedMatches, embedText, keywordScore, mergeRanked, pickTasksForPrompt, planOutbox } from "../apps/projects/src/server/search/rank.ts";

test("notes are embedded only when the project allows note search", () => {
  const t = { title: "Book the gala venue", phase: "Event", notes: "Call Dana at the Grand Hall." };
  assert.equal(embedText({ ...t, readNotes: false }), "Book the gala venue\nPhase: Event");
  assert.match(embedText({ ...t, readNotes: true }), /Grand Hall/);
});

test("the outbox plan upserts live tasks and deletes the rest", () => {
  const plan = planOutbox(
    [
      { task_id: "a", op: "upsert", queued_at: 1 },
      { task_id: "b", op: "delete", queued_at: 2 },
      { task_id: "c", op: "upsert", queued_at: 3 },
      { task_id: "d", op: "upsert", queued_at: 4 }
    ],
    [
      { id: "a", title: "Venue", phase: "", notes: "secret", project_id: "p1", company_id: "c1", read_notes: false },
      { id: "d", title: "No company", phase: "", notes: "", project_id: "p9", company_id: null, read_notes: false }
    ]
  );
  assert.deepEqual(plan.upserts, [{ id: "a", text: "Venue", namespace: "c1", projectId: "p1" }]);
  assert.deepEqual(plan.deletes.sort(), ["b", "c", "d"]);
});

test("rank fusion puts tasks found both ways first", () => {
  const merged = mergeRanked(["x", "y", "z"], ["w", "y"]);
  assert.equal(merged[0].id, "y");
  assert.equal(merged[0].match, "both");
  assert.equal(merged.find((m) => m.id === "w")?.match, "meaning");
  assert.equal(merged.find((m) => m.id === "x")?.match, "word");
});

test("results from projects the person cannot see are dropped", () => {
  const hits = [
    { taskId: "1", projectId: "mine" },
    { taskId: "2", projectId: "secret" },
    { taskId: "3", projectId: "other-company" }
  ];
  assert.deepEqual(allowedMatches(hits, new Set(["mine"])).map((h) => h.taskId), ["1"]);
});

test("keyword score favors titles, then phases, then notes", () => {
  const terms = ["venue"];
  assert.ok(keywordScore(terms, { title: "Book venue", phase: "", notes: "" }) > keywordScore(terms, { title: "", phase: "Venue", notes: "" }));
  assert.ok(keywordScore(terms, { title: "", phase: "Venue", notes: "" }) > keywordScore(terms, { title: "", phase: "", notes: "the venue" }));
});

test("big projects send matching and urgent tasks to the agent", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: `t${i}`, status: i < 60 ? "done" : "todo", end_date: `2026-12-${String((i % 28) + 1).padStart(2, "0")}` }));
  rows.push({ id: "late", status: "todo", end_date: "2026-10-01" });
  rows.push({ id: "busy", status: "doing", end_date: "2026-12-30" });
  const { rows: picked, hidden } = pickTasksForPrompt(rows, ["t3", "t7"], "2026-11-05", 40);
  const ids = picked.map((r) => r.id);
  assert.equal(picked.length, 40);
  assert.equal(hidden, rows.length - 40);
  assert.ok(ids.includes("t3") && ids.includes("t7"), "matching tasks come first, even when done");
  assert.ok(ids.includes("busy") && ids.includes("late"), "work in progress and late work are kept");
  assert.equal(pickTasksForPrompt(rows.slice(0, 10), [], "2026-11-05").hidden, 0);
});
