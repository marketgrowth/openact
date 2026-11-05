# AG-UI in OpenAct

OpenAct speaks [AG-UI](https://docs.ag-ui.com), the Agent-User Interaction protocol. AG-UI is an open, event-based protocol between an agent and a user interface. Because OpenAct follows it, you can add an agent later without changing the web app, and any AG-UI client can talk to the OpenAct agent.

## What works today

- **Endpoint.** `POST /api/projects/:id/agent` takes an AG-UI `RunAgentInput` and streams AG-UI events as Server-Sent Events.
- **Assistant.** The agent answers questions about the project in text. It calls the AI provider through Cloudflare AI Gateway, like the other AI features.
- **Web app.** **AI assist > Ask** uses the endpoint. It sends the shared state, the context and the frontend tools with every run.
- **Frontend tools.** The web app can run four tools when an agent calls them: `open_task`, `show_view`, `go_to_date` and `filter_tasks`. The current agent does not call tools yet.
- **Compatibility.** The official `@ag-ui/client` `HttpAgent` reads the stream.

## The run

```
POST /api/projects/:id/agent
Content-Type: application/json
Cookie: openact_session=...

{
  "threadId": "...",
  "runId": "...",
  "state": { "projectId": "...", "view": "calendar", "focusDate": "2026-11-18", ... },
  "messages": [{ "id": "m1", "role": "user", "content": "What is late?" }],
  "tools": [ { "name": "go_to_date", "description": "...", "parameters": { ... } }, ... ],
  "context": [{ "description": "Current view", "value": "calendar" }],
  "forwardedProps": {}
}
```

The reply is `text/event-stream`. Each event is one `data:` line with JSON, then a blank line:

```
RUN_STARTED
STEP_STARTED  (read_project)
STEP_FINISHED (read_project)
STEP_STARTED  (answer)
TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT, TEXT_MESSAGE_END
STEP_FINISHED (answer)
RUN_FINISHED
```

If something fails, the stream ends with `RUN_ERROR` and a plain message.

The endpoint uses the same session cookie and role checks as the rest of the API. A person must be a member of the project.

## Shared state

The web app sends `OpenActAgentState` as `RunAgentInput.state`. It is defined in `src/shared/agui.ts`:

| Field | Meaning |
| --- | --- |
| `projectId`, `projectName` | The open project |
| `view` | `board`, `timeline`, `calendar` or `members` |
| `focusDate` | The day the calendar highlights, or `null` |
| `openTaskId` | The task open in the drawer, or `null` |
| `filter` | The text filter and the "My tasks" switch |
| `today` | The person's local date |

The web app's reducer (`src/client/agui/reducer.ts`) already applies `STATE_SNAPSHOT` and `STATE_DELTA` (JSON Patch) events, so an agent can send state changes.

## Frontend tools

Frontend tools change only what the person sees. They never change project data.

| Tool | Arguments | What the web app does |
| --- | --- | --- |
| `open_task` | `taskId` | Opens the task in the right-side drawer |
| `show_view` | `view` | Switches to Board, Timeline, Calendar or People |
| `go_to_date` | `date` (YYYY-MM-DD) | Shows that month on the calendar and highlights the day |
| `filter_tasks` | `query`, `mine` | Sets the task filter |

The flow follows the AG-UI spec:

1. The agent sends `TOOL_CALL_START`, `TOOL_CALL_ARGS` (JSON in pieces) and `TOOL_CALL_END`.
2. The web app runs the tool with the handlers in `src/client/pages/Project.tsx`.
3. The web app starts a new run. It adds an assistant message with `toolCalls` and a `tool` message with the result.
4. The agent continues. The web app stops after 3 rounds, so a confused agent cannot loop.

## Add agentic features

1. **Teach the agent to call tools.** In `src/worker/agui.ts`, send `input.tools` to a model that supports tool calling, through AI Gateway. Stream each call as `TOOL_CALL_START`, `TOOL_CALL_ARGS` and `TOOL_CALL_END`.
2. **Add a frontend tool.** Add it to `UI_TOOLS` and `UiToolName` in `src/shared/agui.ts`. Add a handler in `src/client/pages/Project.tsx`. TypeScript tells you if a handler is missing.
3. **Add a backend tool that changes data**, such as "move this task". Run it in the Worker, not in the browser. Check the person's role with `requireRole`, write with `bumpRev`, and send `TOOL_CALL_RESULT`. Ask the person to confirm before a change they cannot undo.
4. **Stream text.** Send many `TEXT_MESSAGE_CONTENT` events as the model writes. The web app already joins them.
5. **Long-running agents.** Move the run into a Durable Object (for example with the Cloudflare Agents SDK) and keep the same AG-UI events. The web app does not need to change.

## Use another AG-UI client

```ts
import { HttpAgent } from "@ag-ui/client";

const agent = new HttpAgent({ url: "https://your-openact.example.com/api/projects/PROJECT_ID/agent" });
agent.addMessage({ id: "m1", role: "user", content: "What is due this week?" });
await agent.runAgent({ tools: [], context: [] }, { onTextMessageContentEvent: ({ event }) => console.log(event.delta) });
```

Run it in the browser on the same origin, so the session cookie goes with the request. The API rejects cross-site writes.

## Data limits

The agent gets task titles, statuses, priorities, phases, dates, task ids and assignee names. It does not get notes, files or email addresses. Context items from the web app are cut to 2,000 characters and are treated as data, not instructions.
