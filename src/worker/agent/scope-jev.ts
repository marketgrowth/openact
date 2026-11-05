/*
 * The scope check with Jev, TypeSafe's System One model.
 *
 * Jev answers typed questions about the request. It makes the judgments.
 * The truth table in decideScope() makes the decision, in code, where it is visible and testable.
 *
 * All question wording, options and thresholds live in this file, so people can audit and edit them in one place.
 * Docs: https://docs.typesafe.ai
 *
 * Pure module with type-only imports, so Node can unit test it.
 */
import type { ScopeDecision, ScopeInput } from "./scope";

/** Pinned, because the thresholds below were set for this release. Change it on purpose, then check the tests and the activity log. */
export const DEFAULT_JEV_MODEL = "jev-1.14.0";

/** A Noul at or above YES reads as yes. At or below NO reads as no. Between them is unsettled, and unsettled never declines a request. */
export const YES = 0.7;
export const NO = 0.3;

/** Labels for off-topic requests in the activity log. The log never holds the message. */
export const TOPICS: Record<string, string> = {
  writing: "The person wants text written or edited that is not about project work, such as a poem, a story or a personal letter.",
  coding: "The person wants help with programming or code.",
  facts_and_trivia: "The person asks a general knowledge question, such as a fact, a definition or trivia.",
  personal_life: "The person asks about health, relationships, money or other personal matters.",
  entertainment: "The person wants a joke, a game, or chat for fun.",
  shopping_and_travel: "The person asks about products to buy, recipes, restaurants or travel.",
  something_else: "None of the other kinds fit."
};

export const TOPIC_LABELS: Record<string, string> = {
  writing: "non-project writing",
  coding: "coding help",
  facts_and_trivia: "general knowledge",
  personal_life: "personal matters",
  entertainment: "entertainment",
  shopping_and_travel: "shopping, food or travel",
  something_else: "another subject"
};

type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> };

export interface JevRequest {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, JevQuestion>;
}

/** Maps Choice option keys back to project ids. */
export type ProjectOptions = Record<string, { id: string; name: string }>;

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "project";

/** Descriptive, unique option keys from project names. Option keys are sent to the model, so they carry meaning. */
export function projectOptions(projects: Array<{ id: string; name: string }>): ProjectOptions {
  const out: ProjectOptions = {};
  for (const p of projects.slice(0, 30)) {
    let key = slug(p.name);
    for (let n = 2; key in out; n++) key = `${slug(p.name)}_${n}`;
    out[key] = p;
  }
  return out;
}

/**
 * The state is what a person would look at to judge the request. Empty fields are left out,
 * because the model can read an empty list as a signal.
 */
export function buildJevRequest(input: ScopeInput, model = DEFAULT_JEV_MODEL): { request: JevRequest; options: ProjectOptions } {
  const options = projectOptions(input.otherProjects);
  const hasOthers = Object.keys(options).length > 0;
  const hasReply = input.lastReply.trim().length > 0;

  const current: Record<string, unknown> = { name: input.projectName };
  if (input.projectDescription.trim()) current.description = input.projectDescription.trim().slice(0, 300);
  if (input.columns.length) current.board_columns = input.columns.slice(0, 12);
  if (input.taskTitles.length) current.some_task_titles = input.taskTitles.slice(0, 40);

  const state: Record<string, unknown> = {
    app: "OpenAct, a project management tool with boards, timelines and calendars. Each project has its own AI agent.",
    current_project: current
  };
  if (hasOthers) state.other_projects = Object.values(options).map((p) => p.name);
  if (hasReply) state.agent_last_reply = input.lastReply.slice(0, 400);
  state.message = input.message.slice(0, 1000);

  const questions: Record<string, JevQuestion> = {
    about_current_project: {
      type: "noul",
      instructions: "`message` is about the project in `current_project`, or about how to use the app for it.",
      criteria: {
        true: "The person asks about or wants to change this project's tasks, dates, board columns, members or progress.",
        false: "The person asks about a different subject, a different project, or work that is separate from this project."
      }
    },
    is_project_work: {
      type: "noul",
      instructions: "`message` is about planning, tracking or doing work in a team or a project.",
      criteria: {
        true: "The person talks about tasks, schedules, deadlines, projects, teammates or this app.",
        false: "The person wants something unrelated to project work, such as a recipe, a joke, trivia, homework or a personal letter."
      }
    },
    general_advice: {
      type: "noul",
      instructions: "`message` asks for general advice about managing projects, not about one specific project.",
      criteria: {
        true: "The person asks how to run a retrospective, estimate work, plan a sprint or run a kickoff meeting.",
        false: "The person asks about the tasks or dates of a specific project, or about a subject that is not project management."
      }
    },
    new_separate_work: {
      type: "noul",
      instructions: "`message` describes new work with its own goal that does not belong in `current_project`.",
      criteria: {
        true: "The person wants to plan or start a separate effort, such as hiring for a new role or organizing an unrelated event.",
        false: "The work fits the current project, or the message does not describe work to plan."
      }
    },
    off_topic_kind: {
      type: "choice",
      instructions: "What kind of request is `message`?",
      criteria: { ...TOPICS }
    }
  };

  if (hasReply) {
    questions.continues_conversation = {
      type: "noul",
      instructions: "`message` is a reply to `agent_last_reply`.",
      criteria: {
        true: "The person answers or follows up on the agent's last reply, for example \"yes\", \"do that\" or \"what about the second one\".",
        false: "The person starts a new subject that does not depend on the agent's last reply."
      }
    };
  }

  if (hasOthers) {
    questions.about_other_project = {
      type: "noul",
      instructions: "`message` is about one of the projects in `other_projects`, not about `current_project`.",
      criteria: {
        true: "The person names or clearly describes one of the other projects.",
        false: "The person is talking about the current project, or about no project in the list."
      }
    };
    // A Choice always picks an option, so code reads it only when about_other_project is yes.
    questions.which_other_project = {
      type: "choice",
      instructions: "Which project in `other_projects` is `message` about?",
      criteria: Object.fromEntries(Object.entries(options).map(([key, p]) => [key, `The project named "${p.name}".`]))
    };
  }

  return { request: { model, state, questions }, options };
}

export interface JevAnswers {
  [id: string]: { type: string; noul?: number; choice?: string; probabilities?: Record<string, number>; confidence?: number } | undefined;
}

const noul = (a: JevAnswers, id: string): number | null => {
  const v = a[id]?.noul;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const yes = (p: number | null) => p !== null && p >= YES;
const no = (p: number | null) => p !== null && p <= NO;

/**
 * The truth table. Rows are checked in order, and the first match wins.
 *
 * | Row | Jev says                                                  | Route         |
 * | 1   | continues_conversation yes                                | project       |
 * | 2   | about_current_project yes                                 | project       |
 * | 3   | about_other_project yes and a project is picked           | other_project |
 * | 4   | new_separate_work yes and is_project_work not no          | new_work      |
 * | 5   | general_advice yes                                        | general       |
 * | 6   | is_project_work no and about_current_project no           | off_topic     |
 * | 7   | anything else, including unsettled answers                | project       |
 *
 * Row 7 means an unclear request goes to the agent, which still follows the scope rule in its instructions.
 */
export function decideScope(answers: JevAnswers, options: ProjectOptions): ScopeDecision {
  const current = noul(answers, "about_current_project");
  const work = noul(answers, "is_project_work");

  if (yes(noul(answers, "continues_conversation"))) return { route: "project", topic: "" };
  if (yes(current)) return { route: "project", topic: "" };

  if (yes(noul(answers, "about_other_project"))) {
    const key = answers.which_other_project?.choice;
    const project = key ? options[key] : undefined;
    if (project) return { route: "other_project", topic: "", project };
  }

  if (yes(noul(answers, "new_separate_work")) && !no(work)) return { route: "new_work", topic: "", name: "" };

  if (yes(noul(answers, "general_advice"))) return { route: "general", topic: "general project advice" };

  if (no(work) && no(current)) {
    const kind = answers.off_topic_kind?.choice;
    return { route: "off_topic", topic: (kind && TOPIC_LABELS[kind]) || TOPIC_LABELS.something_else };
  }

  return { route: "project", topic: "" };
}
