import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_JEV_MODEL, buildJevRequest, decideScope, projectOptions, type JevAnswers } from "../src/worker/agent/scope-jev.ts";
import { scopeSummary } from "../src/worker/agent/scope.ts";

const base = {
  projectName: "Website relaunch",
  projectDescription: "New site for the spring campaign.",
  columns: ["Backlog", "To do", "Done"],
  taskTitles: ["Write home page copy", "Go live"],
  otherProjects: [
    { id: "p2", name: "Fall fundraiser" },
    { id: "p3", name: "Office move" }
  ],
  lastReply: "",
  message: "Move the late tasks to next week"
};

const n = (p: number) => ({ type: "noul", noul: p });
const options = projectOptions(base.otherProjects);

test("the request uses the HTTP shape and a pinned model", () => {
  const { request } = buildJevRequest(base);
  assert.equal(request.model, DEFAULT_JEV_MODEL);
  assert.equal(typeof request.state.message, "string");
  assert.equal(request.questions.about_current_project.type, "noul");
  assert.equal(request.questions.off_topic_kind.type, "choice");
});

test("empty fields stay out of the state, and their questions stay out too", () => {
  const { request } = buildJevRequest({ ...base, otherProjects: [], lastReply: "", projectDescription: "" });
  assert.equal("other_projects" in request.state, false);
  assert.equal("agent_last_reply" in request.state, false);
  assert.equal("description" in (request.state.current_project as object), false);
  assert.equal("which_other_project" in request.questions, false);
  assert.equal("continues_conversation" in request.questions, false);
});

test("project options get descriptive, unique keys", () => {
  const o = projectOptions([
    { id: "a", name: "Fall fundraiser" },
    { id: "b", name: "Fall Fundraiser!" },
    { id: "c", name: "!!!" }
  ]);
  assert.deepEqual(Object.keys(o), ["fall_fundraiser", "fall_fundraiser_2", "project"]);
  assert.equal(o.fall_fundraiser_2.id, "b");
});

test("every question references state by path in backticks", () => {
  const { request } = buildJevRequest({ ...base, lastReply: "Two tasks are late." });
  for (const q of Object.values(request.questions)) assert.match(q.instructions, /`[a-z_]+`/);
});

test("truth table: about this project or a follow-up goes to the agent", () => {
  assert.equal(decideScope({ about_current_project: n(0.92), is_project_work: n(0.95) }, options).route, "project");
  assert.equal(decideScope({ continues_conversation: n(0.9), about_current_project: n(0.1), is_project_work: n(0.1) }, options).route, "project");
});

test("truth table: another project is routed only with a yes and a known option", () => {
  const a: JevAnswers = { about_current_project: n(0.1), about_other_project: n(0.88), which_other_project: { type: "choice", choice: "office_move" } };
  assert.deepEqual(decideScope(a, options).project, { id: "p3", name: "Office move" });
  assert.equal(decideScope({ ...a, about_other_project: n(0.5) }, options).route, "project");
  assert.equal(decideScope({ ...a, which_other_project: { type: "choice", choice: "made_up" } }, options).route, "project");
});

test("truth table: new work, general advice and off-topic", () => {
  assert.equal(decideScope({ about_current_project: n(0.1), new_separate_work: n(0.85), is_project_work: n(0.9) }, options).route, "new_work");
  // New work needs project work: a poem is not new work.
  assert.equal(decideScope({ about_current_project: n(0.05), new_separate_work: n(0.8), is_project_work: n(0.1) }, options).route, "off_topic");
  assert.equal(decideScope({ about_current_project: n(0.2), general_advice: n(0.9), is_project_work: n(0.9) }, options).route, "general");
  const off = decideScope({ about_current_project: n(0.02), is_project_work: n(0.03), off_topic_kind: { type: "choice", choice: "shopping_and_travel" } }, options);
  assert.deepEqual(off, { route: "off_topic", topic: "shopping, food or travel" });
});

test("truth table: unsettled or missing answers never decline", () => {
  assert.equal(decideScope({ about_current_project: n(0.5), is_project_work: n(0.5) }, options).route, "project");
  assert.equal(decideScope({ about_current_project: n(0.1), is_project_work: n(0.45) }, options).route, "project");
  assert.equal(decideScope({}, options).route, "project");
});

test("log lines read well without a topic or a name", () => {
  assert.equal(scopeSummary({ route: "other_project", topic: "", project: { id: "p2", name: "Fall fundraiser" } }, "route_other"), 'Pointed to "Fall fundraiser"');
  assert.equal(scopeSummary({ route: "new_work", topic: "", name: "" }, "suggest_new"), "Suggested a new project");
});
