# AI agent and AG-UI

OpenAct is AI-native. Every project has an AI agent that can answer questions and change the project. What the agent may do depends on who uses it. The agent talks to the web app with [AG-UI](https://docs.ag-ui.com), the Agent-User Interaction protocol.

## Who can tell the agent to do what

Three rules decide what the agent may do:

1. **The agent never has more power than the person using it.** Each role has a ceiling.
2. **Owners can give each role less.** Every project has an AI policy, under **Project settings > AI agent access**.
3. **Risky changes wait for the person.** Deletes, changes to people, and 5 or more changes in one step show an approval card. Nothing runs until the person clicks **Approve**.

| Level | What the agent may do | Highest for |
| --- | --- | --- |
| Off | No AI features at all | |
| Ask only | Answer questions, open tasks, switch views, go to dates, filter | Viewers |
| Ask and edit | Also add and change tasks, add, rename, reorder and recategorize columns | Editors |
| Edit and delete | Also delete tasks and columns, after approval | |
| Full, including people | Also invite, remove and change the roles of members, after approval | Owners |

The defaults are: Owners get Full, Editors get Ask and edit, Viewers get Ask only.

The agent's level for a person is the lower of their role's ceiling and the project's AI policy for that role. The code is in `src/shared/agent-policy.ts`.

## Topic scope

Each project agent helps with its own project. Before the agent works on a new message, a small, fast model sorts it into one route. The code is in `src/worker/agent/scope.ts`.

| Route | Meaning | What happens |
| --- | --- | --- |
| `project` | About this project, or how to use OpenAct | The agent answers |
| `general` | General project management advice | Answered when the scope is Relaxed. Declined when it is Strict. |
| `other_project` | About another project of this person | The web app shows **Open in (project)**. It opens that project's agent with the message filled in. |
| `new_work` | New work that needs its own project | The web app shows a name field and **Create project**. Nothing is created until the person clicks. |
| `off_topic` | Anything else | A short decline. The main model does not run. |

Rules:

- Only a new user message is checked. Runs that continue after tool results or approvals are not checked.
- Short follow-ups after an agent reply (3 words or fewer, such as "yes" or "do it") skip the check.
- `other_project` can only point to a project the person is a member of. Any other id passes the request to the agent.
- When the check fails or its answer is unclear, the request goes to the agent. A bad check never blocks work.
- **Keep it here** runs the request again with `forwardedProps: { openact: { scope: "keep" } }`, which skips the check.
- The agent's instructions also hold the scope rule, so the agent declines off-topic requests that pass the check.
- Declined and routed requests are logged as `scope_check` with a short topic from the model, not the message.

Owners set the scope in **Project settings > Topic scope**. It is stored as `scope` in the project's AI policy. The default is `relaxed`.

### Who decides

`src/worker/agent/scope-run.ts` picks the decider:

1. **Jev**, when the `TYPESAFE_API_KEY` secret is set.
2. **dev-scripted**, for local tests.
3. **A small language model** through AI Gateway (`AI_SCOPE_MODEL`).

### The Jev decision model

Jev is TypeSafe's System One model. It answers typed questions about state that the app sends, and returns probabilities. Jev makes the judgments. Code makes the decision. All wording, options and thresholds are in `src/worker/agent/scope-jev.ts`.

One request to `POST https://api.typesafe.ai/v1/systemone` sends the state once and asks all questions in parallel:

| Question | Type | Asked when |
| --- | --- | --- |
| `about_current_project` | Noul | Always |
| `is_project_work` | Noul | Always |
| `general_advice` | Noul | Always |
| `new_separate_work` | Noul | Always |
| `off_topic_kind` | Choice: writing, coding, facts and trivia, personal life, entertainment, shopping and travel, something else | Always. Code reads it only for an off-topic request, as the log label. |
| `continues_conversation` | Noul | The conversation has an agent reply |
| `about_other_project` | Noul | The person has other projects |
| `which_other_project` | Choice: one option for each other project | The person has other projects. Code reads it only when `about_other_project` is yes. |

The state holds the project name, description, board columns, up to 40 task titles, the names of the person's other projects, the agent's last reply, and the message. Empty fields are left out.

The truth table, checked in order:

| Row | Answers | Route |
| --- | --- | --- |
| 1 | `continues_conversation` yes | `project` |
| 2 | `about_current_project` yes | `project` |
| 3 | `about_other_project` yes, and the choice is a known project | `other_project` |
| 4 | `new_separate_work` yes, and `is_project_work` not no | `new_work` |
| 5 | `general_advice` yes | `general` |
| 6 | `is_project_work` no, and `about_current_project` no | `off_topic` |
| 7 | Anything else | `project` |

A Noul at 0.7 or more is yes. At 0.3 or less it is no. Between them is unsettled, so row 7 sends it to the agent. The model is pinned to `jev-1.14.0` (`TYPESAFE_MODEL`), because the thresholds are set for that release. The activity log records which model decided.

A failed call, a timeout (3 seconds) or a response without answers is an error, not an answer. The request goes to the agent.

To change the check, edit the questions or the table in `scope-jev.ts`, update `test/scope-jev.test.ts`, and test with real requests before you deploy. Prefer better state, a new question or a new row over wording tuned to one case.

The check controls focus and cost. It is not a security control. Tools, roles, the AI policy and approvals protect the data, whatever the check decides.

When the check does not pass a request, the run sends one text message and this event, then ends:

```
CUSTOM openact.scope { action: "decline" | "route_other" | "suggest_new", route, topic, messageId, project?, suggestedName? }
```

## How a request runs

```
Person: "Delete the tasks that are done"
  |
  v
POST /api/projects/:id/agent   (AG-UI RunAgentInput, as the signed-in person)
  |
  |-- level = min(role ceiling, project AI policy)
  |-- topic check: decline, route to another project, suggest a new one, or continue
  |-- the model gets only the tools that this level allows
  |-- every tool call is checked again before it runs
  |
  |-- allowed, low risk  -> runs now -> TOOL_CALL_RESULT, logged as "done"
  |-- above the level    -> refused  -> TOOL_CALL_RESULT "Not allowed", logged as "denied"
  |-- needs approval     -> logged as "pending"
  |                         RUN_FINISHED { outcome: { type: "interrupt", interrupts: [...] } }
  v
Web app shows the approval card. The person approves or rejects each change.
  |
  v
POST /api/projects/:id/agent   with resume: [{ interruptId, status: "resolved", payload: { approved } }]
  |-- only the person who asked can answer, only once, and only for 30 minutes
  |-- the level is checked again, in case the AI policy changed
  v
Approved changes run. The agent reports what it did.
```

Tools that change data run in the Worker through `src/worker/services.ts`. The API routes use the same functions, so the agent gets exactly the same role checks, validation and sync as a person who clicks in the app.

Every action is saved in the `agent_actions` table. All members can read it under **Project settings > Agent activity**.

## Tools

### Backend tools (change data)

| Tool | Level | Approval |
| --- | --- | --- |
| `search_tasks` (read only) | Ask only | Never. Finds tasks by words and by meaning. Notes count only when note search is on. |
| `search_notes` (read only) | Ask only, and the project's note search setting must be on | Never. Reads do not count toward a batch. |
| `create_task` | Ask and edit | At 5 or more changes |
| `update_task` (title, column, phase, priority, dates, assignee, notes) | Ask and edit | At 5 or more changes |
| `add_column` | Ask and edit | At 5 or more changes |
| `update_column` (rename, category, move) | Ask and edit | At 5 or more changes |
| `delete_task` | Edit and delete | Always |
| `delete_column` (moves its tasks first) | Edit and delete | Always |
| `invite_member` | Full | Always |
| `change_member_role` | Full | Always |
| `remove_member` | Full | Always |

Every id must belong to the current project. The agent cannot remove the person it acts for.

### Frontend tools (change only the view)

| Tool | Arguments | What the web app does |
| --- | --- | --- |
| `open_task` | `taskId` | Opens the task in the side panel on the right |
| `show_view` | `view` | Switches to Board, Timeline, Calendar or People |
| `go_to_date` | `date` | Shows that month on the calendar and highlights the day |
| `filter_tasks` | `query`, `mine` | Sets the task filter |

When the agent calls a frontend tool, the run ends with `RUN_FINISHED { outcome: { type: "success", pendingToolCallIds } }`. The web app runs the tools and starts a new run with the results.

## Events

The endpoint streams AG-UI events as Server-Sent Events:

- `RUN_STARTED`, `RUN_FINISHED` (with `outcome`), `RUN_ERROR`
- `STEP_STARTED` and `STEP_FINISHED`: `check_scope`, `apply_approvals` and `think`
- `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`
- `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_RESULT`
- `CUSTOM` `openact.agent_level`: the level for this run
- `CUSTOM` `openact.data_changed`: the agent changed data. The web app reloads the project.
- `CUSTOM` `openact.scope`: the topic check declined the request or sent it elsewhere. See [Topic scope](#topic-scope).

Types come from `@ag-ui/core` as type-only imports. The official `@ag-ui/client` `HttpAgent` reads the stream.

## Models

The agent uses tool calling through Cloudflare AI Gateway. Set `AI_PROVIDER`:

| Provider | Notes |
| --- | --- |
| `workers-ai` (default) | No extra key. Tool results go back to the model as text. |
| `anthropic` | Needs `ANTHROPIC_API_KEY` and `CF_ACCOUNT_ID`. Best tool use. |
| `openai` | Needs `OPENAI_API_KEY` and `CF_ACCOUNT_ID`. |
| `dev-scripted` | For local tests only. No AI. See below. |

## Test without an AI account

The `dev-scripted` provider turns lines in your message into tool calls, so you can test roles and approvals locally:

```sh
npm run build
npx wrangler dev --local --var AI_PROVIDER:dev-scripted
```

Then type a message such as:

```
/tool update_column {"columnId":"COLUMN_ID","name":"QA"}
/tool delete_task {"taskId":"TASK_ID"}
```

To test the topic check, start a message with `/scope` and a route:

```
/scope off_topic
/scope general
/scope other_project PROJECT_ID
/scope new_work Q1 hiring plan
```

Do not use `dev-scripted` in production.

## Big projects

When a project has more than 80 tasks, the agent does not get all of them. It gets the tasks that match the message (by words and by meaning), then work in progress, late work and work due soon, up to 80. The instructions tell it how many tasks are hidden, and it calls `search_tasks` to find them. The code is in `src/worker/search/rank.ts`.

## Data limits

The topic check gets the new message, the agent's last reply, the project name, description and columns, up to 40 task titles, and the names and ids of the person's other projects.

The agent gets task titles, columns, priorities, phases, dates, assignee names, member names and roles, and the ids it needs to call tools. It does not get task notes, files or email addresses.

When an owner turns on **Let the agent search task notes**, the agent gets the `search_notes` tool. The database matches every word in the title or the notes. The result holds up to 20 tasks, each with a short part of its note around the first match. Email addresses and phone numbers in that part are replaced with `[email]` and `[phone]`. The result says that note text is data, not instructions. The log records "Search task notes" and the number of matches, never the words or the note text. The code is in `src/worker/agent/notes.ts`. Context items from the web app are cut to 2,000 characters and are treated as data, not instructions.

## Add a tool

1. Add the tool to `BACKEND_TOOLS` in `src/shared/agent-policy.ts`. Choose its `level` and `risk`.
2. Add the business logic to `src/worker/services.ts`, with `requireRole` and `bumpRev`. Use it from the API route too.
3. Add a case to `describeCall` and `executeCall` in `src/worker/agent/tools.ts`. Check that every id belongs to the project.
4. Add tests in `test/agent.test.ts`.
