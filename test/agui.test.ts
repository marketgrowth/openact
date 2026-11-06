import { test } from "node:test";
import assert from "node:assert/strict";
import { SseParser } from "../apps/projects/src/client/agui/sse.ts";
import { applyPatch, emptyRun, reduceEvent, type RunView } from "../apps/projects/src/client/agui/reducer.ts";
import { executeToolCall } from "../apps/projects/src/client/agui/tools.ts";
import type { AguiEvent } from "../apps/projects/src/shared/agui.ts";

test("SSE parser joins chunks and splits frames", () => {
  const p = new SseParser();
  assert.deepEqual(p.push('data: {"a":1}\n\ndata: {"b"'), ['{"a":1}']);
  assert.deepEqual(p.push(':2}\r\n\r\n: comment\n\n'), ['{"b":2}']);
});

test("reducer builds an answer from a full AG-UI run", () => {
  const events: AguiEvent[] = [
    { type: "RUN_STARTED", threadId: "t", runId: "r" },
    { type: "STEP_STARTED", stepName: "answer" },
    { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Two tasks " },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "are late." },
    { type: "TEXT_MESSAGE_END", messageId: "m1" },
    { type: "STEP_FINISHED", stepName: "answer" },
    { type: "RUN_FINISHED", threadId: "t", runId: "r" }
  ];
  let v: RunView = emptyRun([{ id: "u1", role: "user", content: "What is late?" }]);
  const seen: string[] = [];
  for (const e of events) {
    v = reduceEvent(v, e);
    seen.push(v.step ?? "-");
  }
  assert.equal(v.status, "finished");
  assert.equal(v.messages.length, 2);
  assert.equal(v.messages[1].content, "Two tasks are late.");
  assert.ok(seen.includes("answer"));
});

test("reducer collects streamed tool call arguments", () => {
  let v = emptyRun();
  v = reduceEvent(v, { type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "go_to_date" });
  v = reduceEvent(v, { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: '{"date":"2026-' });
  v = reduceEvent(v, { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: '12-01"}' });
  v = reduceEvent(v, { type: "TOOL_CALL_END", toolCallId: "c1" });
  assert.deepEqual(v.toolCalls[0], { id: "c1", name: "go_to_date", args: '{"date":"2026-12-01"}', done: true, parentMessageId: undefined });
});

test("reducer applies state snapshots and JSON Patch deltas", () => {
  let v = emptyRun();
  v = reduceEvent(v, { type: "STATE_SNAPSHOT", snapshot: { view: "board", filter: { query: "", mine: false }, tags: ["a"] } });
  v = reduceEvent(v, {
    type: "STATE_DELTA",
    delta: [
      { op: "replace", path: "/view", value: "calendar" },
      { op: "add", path: "/tags/-", value: "b" },
      { op: "remove", path: "/filter/mine" }
    ]
  });
  assert.deepEqual(v.state, { view: "calendar", filter: { query: "" }, tags: ["a", "b"] });
});

test("applyPatch does not change the input object", () => {
  const before = { a: { b: 1 } };
  applyPatch(before, [{ op: "replace", path: "/a/b", value: 2 }]);
  assert.equal(before.a.b, 1);
});

test("tool calls run handlers and report errors as results", () => {
  const handlers = {
    go_to_date: (a: Record<string, unknown>) => `Showing ${a.date}.`,
    open_task: () => {
      throw new Error("There is no task with id x.");
    }
  };
  assert.deepEqual(executeToolCall(handlers, "go_to_date", '{"date":"2026-12-01"}'), { ok: true, content: "Showing 2026-12-01." });
  assert.deepEqual(executeToolCall(handlers, "open_task", '{"taskId":"x"}'), { ok: false, content: "There is no task with id x." });
  assert.equal(executeToolCall(handlers, "delete_everything", "{}").ok, false);
  assert.equal(executeToolCall(handlers, "go_to_date", "{not json").ok, false);
});

test("a scope notice attaches to its reply", () => {
  let v = emptyRun();
  v = reduceEvent(v, { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" } as never);
  v = reduceEvent(v, { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "This sounds like new work." } as never);
  v = reduceEvent(v, { type: "CUSTOM", name: "openact.scope", value: { action: "suggest_new", route: "new_work", topic: "hiring", messageId: "m1", suggestedName: "Q1 hiring" } } as never);
  assert.equal(v.messages[0].scope?.action, "suggest_new");
  assert.equal(v.messages[0].scope?.suggestedName, "Q1 hiring");
});
