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
| Add an app | `npm run openact -- add github:owner/repo` |
| Write `.openact/` | `npm run sync` (the other scripts run it) |

Run `npm run typecheck`, `npm test` and `npm run build` before you say a task is done.

## Where code goes

OpenAct is a core plus apps. Read `docs/APPS.md` before you add or move code.

- Core server (`@openact/core`): `packages/core/src/server/`. Sign-in, sessions, companies, roles, live rooms, email, the app system (`apps.ts`) and the Worker factory (`worker.ts`). Apps import only from `@openact/core/server` and `@openact/core/shared`.
- Core types and rules: `packages/core/src/shared/`. People, companies and config.
- Core migrations: `packages/core/migrations/`. Never edit a released migration.
- Web shell and UI kit (`@openact/ui`): `packages/ui/src/`. The shell, side panel, sign-in and company settings are in `shell/`. shadcn/ui components are in `components/`. The theme is `theme.css`.
- The projects app: `apps/projects/`. Server code in `src/server/`, web code in `src/client/`, types and rules in `src/shared/`, new migrations in `migrations/`.
- Other apps: `apps/<id>/`, listed in `openact.apps.json`.
- The host (this deploy): `src/worker.ts`, `src/client/main.tsx` and `src/client/site.tsx` (the colophon).
- `.openact/` is written by `npm run sync`. Never edit it.

The core must never import from an app. If the core needs something from apps, add a hook to `AppHooks` in `packages/core/src/server/apps.ts` or a slot to `ClientApp` in `packages/ui/src/apps.tsx`.

## Rules you must follow

1. **Check access.** Every project route calls `requireRole(env, projectId, userId, minRole)`. Use the lowest role that can do the action. `requireRole` combines the project role, the company role and the project's visibility (`apps/projects/src/shared/access.ts`). Never decide access by reading `project_members` alone. To list projects, use `visibleProjectIds`. Company routes call `requireCompanyRole`.
2. **Bump the revision.** Every write to a project's data includes `bumpRev(env, projectId)` in the same `DB.batch`. `bumpRev` also marks the project as changed, so its live room tells open pages to reload. If you change `rev` with raw SQL, call `markProjectChanged(projectId)` too. Writes that happen after a streamed response starts (the agent) must call `flushProjectChanges(env)`. Other apps use `markChanged(kind, id)` and `flushChanges(env)` from the core.
3. **Validate input** with the helpers in `packages/core/src/server/util.ts`. Throw `HttpError` with a plain message that the web app can show.
4. **Protect secrets.** Store only hashes of codes and tokens. Never log codes, tokens or email bodies when `RESEND_API_KEY` is set.
5. **Limit AI data.** Do not send task notes, files or email addresses to an AI provider without a setting that turns it on. Note search (`readNotes` in the AI policy) is that setting for notes: it sends only short, redacted parts of matching notes.
6. **No new runtime dependencies** without a reason in the pull request.
7. **Theme tokens only.** No literal colors in components, and no fixed Tailwind palette colors (`bg-red-500`, `text-white`). Use token classes (`bg-muted`, `text-muted-foreground`, `text-priority-high`). Add tokens in `packages/ui/src/theme.css` with both light and dark values.
8. **Follow AG-UI.** Agent features use the AG-UI events and types in `apps/projects/src/shared/agui.ts`. Read `docs/AGUI.md` first. Frontend tools only change what the person sees. Tools that change data run in the Worker with `requireRole` and `bumpRev`.
9. **The agent never exceeds the person.** Agent tools live in `BACKEND_TOOLS` (`apps/projects/src/shared/agent-policy.ts`) with a level and a risk. Their logic goes in `apps/projects/src/server/services.ts`, shared with the API. Deletes and people changes always need approval. Never add a way for the agent to skip `requireRole`, the AI policy or approvals.
10. **Keep the topic check a helper.** The scope check in `apps/projects/src/server/agent/scope.ts` controls focus and cost only. Never use it as an access check, and never let a failed check block a request. Log a short topic, never the person's message. With Jev, keep judgments in the questions and the decision in the truth table in `scope-jev.ts`. Never read a failed call as an answer.

11. **Companies isolate data.** Every project, and every row of every app, has a `company_id`. Never show, search or route to a project in another company. A person added to one project from outside the company joins it as a guest.

12. **Search never decides access.** Vectorize results are hints. Check every result against `visibleProjectIds` before you show it or send it to a model. Embed notes only when the project's note search is on.

13. **Live messages carry no data.** `ProjectRoom` sends only revision numbers and viewer names. Pages load data through the API, which checks access. Check the `Origin` header on every WebSocket upgrade.

14. **Use shadcn/ui.** Build UI from the components in `packages/ui/src/components` (import `@openact/ui/components/<name>`) and Tailwind classes. Add a component by running `npx shadcn@latest add <name>` in `packages/ui`. Do not add another UI kit, CSS framework or icon set. Use Lucide icons through `Icon` from `@openact/ui`. Keep the dashboard-01 layout: every signed-in page starts with `SiteHeader` and puts its content in `PageBody`.

15. **Apps stay in their lane.** Prefix an app's tables, routes, file keys, room kinds and command ids with its id. An app reads people and companies through the core. It cleans up its data in the `companyMemberRemoved` and `companyDeleting` hooks.

## Writing style for text in the app and docs

- Short, simple sentences. Active voice. One idea per sentence.
- American spelling.
- No em dashes.
- Error messages say what went wrong and what to do next.

