# AGENTS.md

Rules for AI coding agents (Claude Code, Cursor, Codex and others) that work in this repository. Read all of this file before your first change.

## Commands

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Run locally (no AI) | `npm run dev` |
| Type check | `npm run typecheck` |
| Unit tests | `npm test` |
| Build | `npm run build` |
| Deploy | `npm run deploy` (applies migrations, then deploys) |

Run `npm run typecheck`, `npm test` and `npm run build` before you say a task is done.

## Where code goes

- API routes: `src/worker/*.ts`. Register new routers in `src/worker/index.ts`.
- Shared types and constants: `src/shared/types.ts`. The Worker and the web app both import them.
- Web app: `src/client/`. Pages in `pages/`, parts of pages in `components/`, shadcn/ui components in `components/ui/`. The theme and Tailwind setup are in `index.css`.
- Schema: a new numbered file in `migrations/`. Never edit a released migration.

## Rules you must follow

1. **Check access.** Every project route calls `requireRole(env, projectId, userId, minRole)`. Use the lowest role that can do the action. `requireRole` combines the project role, the company role and the project's visibility (`src/shared/access.ts`). Never decide access by reading `project_members` alone. To list projects, use `visibleProjectIds`. Company routes call `requireCompanyRole`.
2. **Bump the revision.** Every write to a project's data includes `bumpRev(env, projectId)` in the same `DB.batch`. `bumpRev` also marks the project as changed, so its live room tells open pages to reload. If you change `rev` with raw SQL, call `markProjectChanged(projectId)` too. Writes that happen after a streamed response starts (the agent) must call `flushProjectChanges(env)`.
3. **Validate input** with the helpers in `src/worker/util.ts`. Throw `HttpError` with a plain message that the web app can show.
4. **Protect secrets.** Store only hashes of codes and tokens. Never log codes, tokens or email bodies when `RESEND_API_KEY` is set.
5. **Limit AI data.** Do not send task notes, files or email addresses to an AI provider without a setting that turns it on. Note search (`readNotes` in the AI policy) is that setting for notes: it sends only short, redacted parts of matching notes.
6. **No new runtime dependencies** without a reason in the pull request.
7. **Theme tokens only.** No literal colors in components, and no fixed Tailwind palette colors (`bg-red-500`, `text-white`). Use token classes (`bg-muted`, `text-muted-foreground`, `text-priority-high`). Add tokens in `src/client/index.css` with both light and dark values.
8. **Follow AG-UI.** Agent features use the AG-UI events and types in `src/shared/agui.ts`. Read `docs/AGUI.md` first. Frontend tools only change what the person sees. Tools that change data run in the Worker with `requireRole` and `bumpRev`.
9. **The agent never exceeds the person.** Agent tools live in `BACKEND_TOOLS` (`src/shared/agent-policy.ts`) with a level and a risk. Their logic goes in `src/worker/services.ts`, shared with the API. Deletes and people changes always need approval. Never add a way for the agent to skip `requireRole`, the AI policy or approvals.
10. **Keep the topic check a helper.** The scope check in `src/worker/agent/scope.ts` controls focus and cost only. Never use it as an access check, and never let a failed check block a request. Log a short topic, never the person's message. With Jev, keep judgments in the questions and the decision in the truth table in `scope-jev.ts`. Never read a failed call as an answer.

11. **Companies isolate data.** Every project has a `company_id`. Never show, search or route to a project in another company. A person added to one project from outside the company joins it as a guest.

12. **Search never decides access.** Vectorize results are hints. Check every result against `visibleProjectIds` before you show it or send it to a model. Embed notes only when the project's note search is on.

13. **Live messages carry no data.** `ProjectRoom` sends only revision numbers and viewer names. Pages load data through the API, which checks access. Check the `Origin` header on every WebSocket upgrade.

14. **Use shadcn/ui.** Build UI from the components in `src/client/components/ui` and Tailwind classes. Add a component with `npx shadcn@latest add <name>`. Do not add another UI kit, CSS framework or icon set. Use Lucide icons through `Icon` in `src/client/ui.tsx`. Keep the dashboard-01 layout: every signed-in page starts with `SiteHeader` and puts its content in `PageBody`.

## Writing style for text in the app and docs

- Short, simple sentences. Active voice. One idea per sentence.
- American spelling.
- No em dashes.
- Error messages say what went wrong and what to do next.
