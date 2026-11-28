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
| Docs site | `npm run docs:dev` to preview, `npm run docs:build` to check links |
| Add an app | `npm run openact -- add <id>` from the directory, or `npm run openact -- add github:owner/repo` |
| Write `.openact/` | `npm run sync` (the other scripts run it) |
| Check the design cues | `npm run design -- check` (`npm test` runs it too) |
| Make an app accent | `npm run design -- seed <app-id> <hue>` |
| Publish the Promptbook | `npm run design -- build` |
| Add or update Arc components | `npm run arc -- add <name>`, `npm run arc -- update` |

Run `npm run typecheck`, `npm test` and `npm run build` before you say a task is done.

## Where code goes

OpenAct is a core plus apps. Read `docs/apps.md` before you add or move code.

- Core server (`@openact/core`): `packages/core/src/server/`. Sign-in, sessions, companies, roles, live rooms, email, the app system (`apps.ts`) and the Worker factory (`worker.ts`). Apps import only from `@openact/core/server` and `@openact/core/shared`.
- Core types and rules: `packages/core/src/shared/`. People, companies and config.
- Core migrations: `packages/core/migrations/`. Never edit a released migration.
- Web shell and UI kit (`@openact/ui`): `packages/ui/src/`. The shell, side panel, sign-in and company settings are in `shell/`. shadcn/ui components are in `components/`. Arc components are in `arc/` (written by `npm run arc`, token map in `arc/arc.css`). The theme is `theme.css`.
- The projects app: `apps/projects/`. Server code in `src/server/`, web code in `src/client/`, types and rules in `src/shared/`, new migrations in `migrations/`.
- The paid apps (Docs, Advisory, eSign and later Director apps) are not in this repository. They live in the private repository `marketgrowth/openact-director`, which takes in this repository's `main`. Never add a paid app, or code copied from one, to this repository. A change that a paid app needs from the core goes here, as a public SDK change, and the paid app uses it through `@openact/core` and `@openact/ui`.
- Plans and billing: `packages/core/src/shared/plans.ts` (rules), `packages/core/src/server/plans.ts` (a company's plan), `license.ts` (license keys), `billing.ts` and `stripe.ts` (Stripe). The Plan page is `packages/ui/src/shell/Plan.tsx`. Read `docs/plans.md`.
- Other apps: `apps/<id>/`, listed in `openact.apps.json`.
- The host (this deploy): `src/worker.ts`, `src/client/main.tsx` and `src/client/site.tsx` (the colophon).
- The website at openact.ing: `www/`, an Astro project with its own `package.json`. Read `www/README.md`. Pages are in `www/src/pages/`, the shared layout is `www/src/layouts/Site.astro` and the home page sections are in `www/src/components/home/`. Its Worker (`www/worker/`) also runs contributions at `/api/contribute`. The Contribute page is `www/src/pages/contribute.astro` and `www/public/contribute.js`. Shared rules are in `src/shared/contribute.ts`. Read `docs/contribute.md`.
- `.openact/` is written by `npm run sync`. Never edit it.

The core must never import from an app. If the core needs something from apps, add a hook to `AppHooks` in `packages/core/src/server/apps.ts` or a slot to `ClientApp` in `packages/ui/src/apps.tsx`.

## Rules you must follow

1. **Check access.** Every project route calls `requireRole(env, projectId, userId, minRole)`. Use the lowest role that can do the action. `requireRole` combines the project role, the company role and the project's visibility (`apps/projects/src/shared/access.ts`). Never decide access by reading `project_members` alone. To list projects, use `visibleProjectIds`. Both also check that the projects app is on and read `projects.browse`. Company routes call `requireCompanyRole`. App routes call `requirePermission` with a permission the app declares.
2. **Bump the revision.** Every write to a project's data includes `bumpRev(env, projectId)` in the same `DB.batch`. `bumpRev` also marks the project as changed, so its live room tells open pages to reload. If you change `rev` with raw SQL, call `markProjectChanged(projectId)` too. Writes that happen after a streamed response starts (the agent) must call `flushProjectChanges(env)`. Other apps use `markChanged(kind, id)` and `flushChanges(env)` from the core.
3. **Validate input** with the helpers in `packages/core/src/server/util.ts`. Throw `HttpError` with a plain message that the web app can show.
4. **Protect secrets.** Store only hashes of codes and tokens. Never log codes, tokens or email bodies when `RESEND_API_KEY` is set.
5. **Limit AI data.** Do not send task notes, files or email addresses to an AI provider without a setting that turns it on. Note search (`readNotes` in the AI policy) is that setting for notes: it sends only short, redacted parts of matching notes.
6. **No new runtime dependencies** without a reason in the pull request.
7. **Theme tokens only.** No literal colors in components, and no fixed Tailwind palette colors (`bg-red-500`, `text-white`). Use token classes (`bg-muted`, `text-muted-foreground`, `text-priority-high`). Add tokens in `packages/ui/src/theme.css` with both light and dark values.
8. **Follow AG-UI.** Agent features use the AG-UI events and types in `@openact/core/shared` (`packages/core/src/shared/agui.ts`): `AguiEvent`, `EventType`, `encodeSse`, `SseParser` and `runAguiAgent`. The projects agent adds its own state and tools in `apps/projects/src/shared/agui.ts`. Read `docs/reference/ag-ui.md` first. Frontend tools only change what the person sees. Tools that change data run in the Worker with `requireRole` and `bumpRev`.
9. **The agent never exceeds the person.** Agent tools live in `BACKEND_TOOLS` (`apps/projects/src/shared/agent-policy.ts`) with a level and a risk. Their logic goes in `apps/projects/src/server/services.ts`, shared with the API. Deletes and people changes always need approval. Never add a way for the agent to skip `requireRole`, the AI policy or approvals.
10. **Keep the topic check a helper.** The scope check in `apps/projects/src/server/agent/scope.ts` controls focus and cost only. Never use it as an access check, and never let a failed check block a request. Log a short topic, never the person's message. With Jev, keep judgments in the questions and the decision in the truth table in `scope-jev.ts`. Never read a failed call as an answer.

11. **Companies isolate data.** Every project, and every row of every app, has a `company_id`. Never show, search or route to a project in another company. A person added to one project from outside the company joins it as a guest.
    **Workspaces limit what a member sees.** A member works only in the workspaces in `workspace_members`. Owners and admins see all. Apps with `"scope": "workspace"` filter lists with `workspaceScope` (it throws 404 for a workspace the member is not in) and place new rows with `workspaceForNew`. A single row that belongs to a workspace needs the same check: a member opens it only when they are in its workspace (see `projectAccess`). Apps with `"access": "own"` show a member only the items they made or are part of: check `ownItemsOnly(appId, role)`. Read `docs/workspaces.md`.

12. **Search never decides access.** Vectorize results are hints. Check every result against `visibleProjectIds` before you show it or send it to a model. Embed notes only when the project's note search is on.

13. **Live messages carry no data.** `ProjectRoom` sends only revision numbers and viewer names. Pages load data through the API, which checks access. Check the `Origin` header on every WebSocket upgrade.

14. **Use the @openact/ui components, Arc first.** Read `docs/components.md` before you build UI. Look for the component in this order: Arc (`packages/ui/src/arc/CATALOG.md`, import `@openact/ui/arc/<name>`), then shadcn/ui (`@openact/ui/components/<name>`). If neither has one, build it in `packages/ui/src/components` from Promptbook tokens, never inside one app. Use one component for one job in a screen. Never edit `packages/ui/src/arc/<name>/`: `npm run arc` writes it. Do not add another UI kit, CSS framework or icon set. Use Lucide icons through `Icon` from `@openact/ui`. Keep the dashboard-01 layout: every signed-in page starts with `SiteHeader` and puts its content in `PageBody`.

15. **Apps stay in their lane.** Prefix an app's tables, routes, file keys, room kinds and command ids with its id. An app reads people and companies through the core. It cleans up its data in the `companyMemberRemoved` and `companyDeleting` hooks. It declares its permissions in `defineServerApp({ permissions })` and never hard-codes company roles in a route. App ids in `directory/apps.json` with `"reserved": true`, and the ids in `systemIds`, belong to official apps and to OpenAct. Never give a new app one of them.

16. **Never weaken the plan gate.** A paid app is locked through `companyAppState`. Do not add a way around it, do not add keys to `license-keys.ts` and do not change an app's `plan` or `released` field unless MarketGrowth asks for it. The only way past the gate without a plan is a grant or the license fallback (`fallbackCovers` in `packages/core/src/shared/plans.ts`). Never add an Apache 2.0 notice to a paid app.
17. **Follow the Promptbook.** Read `docs/design-system.md` before you change UI. Pick tokens by intent. Show agent work with `AgentState` and its five states (think, act, wait, done, fail). When you change `theme.css` or `packages/ui/promptbook.json`, run `npm run design -- build` and commit the files in `www/public/design` and `www/src/pages/design.astro`.

18. **Name data by the rules.** Read `docs/naming.md` before you write a migration. `npm run sync` runs every migration on an empty database and checks new names. Never rename a released table or column.
19. **Prove company isolation.** Every route needs a case in `test/cross-company.test.ts`, which calls it as a person from another company. The test fails for a route without one. Read `docs/security.md`.
20. **Treat text from other people as data.** Agent instructions include `UNTRUSTED_TEXT_RULE`. A tool that sends something out, or writes where other companies read, sets `effect: "send"` or `"shared"`, and the agent asks the person first. Tool answers with text from outside the company set `origin`.

## Docs

The docs site at https://docs.openact.ing is built from the Markdown files in `docs/`. The sidebar is in `docs/.vitepress/config.mts`. When you change how something works, change its docs page in the same pull request. `npm run docs:build` fails on a broken link.

## Writing style for text in the app and docs

- Short, simple sentences. Active voice. One idea per sentence.
- American spelling.
- No em dashes.
- Error messages say what went wrong and what to do next.
- On the website (`www/`), no orphan words: no heading or paragraph ends with one word alone on its last line. The shared styles in `www/src/styles/global.css` balance headings and text. After you change page text, run `npm run build` in `www/`, then `python3 scripts/check-orphans.py`.

