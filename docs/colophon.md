# Colophon

How OpenAct is made. OpenAct is open source project management with a board, a timeline and a calendar. MarketGrowth makes it and shares it under the MIT license.

The app shows the same page at `/colophon`. Keep the two in step with `package.json` when versions change, and add a build log row for each new milestone.

## What it does

| Feature | What it does |
| --- | --- |
| Apps | OpenAct is a core plus apps. Project management is the first app. Add more from GitHub with one command, and each app gets sign-in, companies and the shell. |
| App rail | A narrow column on the left shows the company, one icon for each app, settings and your menu. The panel beside it shows the active app. |
| Kanban board | Drag cards between columns. Each project has its own columns, and each column says what it means, so progress and late checks keep working. |
| Gantt timeline | Drag a bar to move a task, or an edge to change its length. Tasks group by phase, and a line marks today. |
| Calendar | A month view with start cards and deadline pills. Drag either to change the date. Phones get an agenda list. |
| Tasks | Dates, phase, assignee, notes and files up to 25 MB. Web addresses in notes and descriptions show as links that open in a new tab. |
| Pinned and Recent | Pin projects to the top of the panel. Recent shows the tasks you opened lately, and one click opens a task again. Both are yours only. |
| Companies | One install holds many companies. Switch from the company mark at the top of the app rail. Each company has its own name, logo, people, email domain and AI defaults. |
| Access | Project roles (owner, editor, viewer) and company roles (owner, admin, member, guest). Owners can make a project secret. People without access can ask for it. |
| Permissions | Owners and admins turn apps on or off for their company, and choose what each role can do in each app. Apps declare their permissions, and the core checks them. |
| Search | Ctrl+K or Cmd+K searches every project you can see, by words and by meaning. The task panel shows related tasks. |
| Live updates | A change shows on every open page at once, including changes from the AI agent. The header shows who else is viewing. |
| AI agent | Tell it what to do in plain words. It acts for you, never with more power than your role. Risky changes wait for your approval, and every action is logged. |
| Topic check | A quick check reads each new request. Requests for another project get a link to it. New work gets an offer to start a project. Anything else gets a short decline. |
| Note search | Owners can let the agent search task notes. It gets only short parts, with email addresses and phone numbers hidden. |
| Sign-in | No passwords. People sign in with a 6-digit email code. |
| Themes and phones | Light, dark, or follow the system. On a phone, the rail and the panel open as one sheet. |
| Keyboard | Ctrl+K or Cmd+K opens search. Ctrl+B or Cmd+B opens and closes the app panel. |

## Build log

Milestones, oldest first.

| # | Milestone | What it added | Commit |
| --- | --- | --- | --- |
| 01 | Board and timeline | Projects, a Kanban board, a Gantt timeline, email code sign-in, project roles, file attachments, and AI task drafts and status summaries. | [35dbe6d](https://github.com/marketgrowth/openact/commit/35dbe6d) |
| 02 | Calendar and AG-UI | A month calendar with an agenda list on phones. The assistant starts to speak the AG-UI protocol. | [dd620a6](https://github.com/marketgrowth/openact/commit/dd620a6) |
| 03 | Colophon | This page, and the matching page in the app. | [7e91cc8](https://github.com/marketgrowth/openact/commit/7e91cc8) |
| 04 | Agent access and custom columns | The agent acts with the person's role. Owners set a policy per role. Approvals, an activity log, and board columns that each project names itself. | [3e0d2f7](https://github.com/marketgrowth/openact/commit/3e0d2f7) |
| 05 | Topic check | A small model reads each new request and keeps the agent on its project. | [db30e51](https://github.com/marketgrowth/openact/commit/db30e51) |
| 06 | Jev decision model | With a TypeSafe key, Jev answers typed questions about each request, and a truth table in code picks the route. | [cc0dff8](https://github.com/marketgrowth/openact/commit/cc0dff8) |
| 07 | Note search | An owner setting lets the agent search task notes, with private details hidden. The board filter also searches notes. | [7bfb109](https://github.com/marketgrowth/openact/commit/7bfb109) |
| 08 | Clickable links | Web addresses in descriptions and notes open in a new tab. OpenAct never fetches them. | [891540f](https://github.com/marketgrowth/openact/commit/891540f) |
| 09 | Companies | Multi-tenant companies, a collapsible side panel with a company switcher, secret projects, access requests and email domain auto-join. | [61c310a](https://github.com/marketgrowth/openact/commit/61c310a) |
| 10 | Search by meaning | Vectorize and Workers AI embeddings, merged with word search. Results are checked against what each person can see. | [f78f471](https://github.com/marketgrowth/openact/commit/f78f471) |
| 11 | Live updates | A Durable Object per project holds hibernating WebSockets. Pages check for changes only when the connection is down. | [ce7e4e4](https://github.com/marketgrowth/openact/commit/ce7e4e4) |
| 12 | Features and build log | This page lists what OpenAct does and how it was built. | [c01bf9a](https://github.com/marketgrowth/openact/commit/c01bf9a) |
| 13 | shadcn/ui | The whole web app moves to shadcn/ui, Tailwind CSS and Lucide icons, with the dashboard-01 layout. The chat keeps your place when you scroll up. | [07ea4d1](https://github.com/marketgrowth/openact/commit/07ea4d1) |
| 14 | Core and apps | OpenAct splits into a core, a UI kit and apps. Project management becomes the first app. New apps install from GitHub with `npm run openact -- add`. | [eb5ffe7](https://github.com/marketgrowth/openact/commit/eb5ffe7) |
| 15 | App rail | An app rail with one icon per app, Pinned and Recent in the projects panel, and an Orbytt mockup as the second app. | [f538239](https://github.com/marketgrowth/openact/commit/f538239) |
| 16 | Permissions | Companies turn apps on or off, and choose what each role can do in each app. Apps declare their permissions, and the core checks them. | [66c782f](https://github.com/marketgrowth/openact/commit/66c782f) |
| 17 | Docs site | The docs in `docs/` build into a site for [docs.openact.app](https://docs.openact.app), with a permissions guide and an SDK reference. | [fa7d7fa](https://github.com/marketgrowth/openact/commit/fa7d7fa) |

## Platform

OpenAct runs on Cloudflare. One Worker serves the API and the web app.

| Part | What it does |
| --- | --- |
| [Cloudflare Workers](https://developers.cloudflare.com/workers/) | Runs the API and serves the web app as static assets. Compatibility date 2026-10-01, with `nodejs_compat`. |
| [Cloudflare D1](https://developers.cloudflare.com/d1/) | SQLite database for companies, people, projects, members, tasks and sessions. SQL migrations run on every deploy. |
| [Cloudflare R2](https://developers.cloudflare.com/r2/) | Object storage for task attachments (up to 25 MB per file) and company logos. |
| [Durable Objects](https://developers.cloudflare.com/durable-objects/) | Live updates. One object per project holds its WebSockets, with the Hibernation API. |
| [Cloudflare Vectorize](https://developers.cloudflare.com/vectorize/) | Search by meaning. One namespace per company. Embeddings come from Workers AI (`@cf/baai/bge-base-en-v1.5`, 768 dimensions). |
| [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) | A daily job deletes expired sign-in codes and sessions, and expires agent approvals that nobody answered. Another job indexes changed tasks for search every 10 minutes. |
| [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/) | One-click deploy. It creates the database and the bucket, then asks for the secrets. |

## AI

AI features are optional helpers. Every request goes through one gateway.

| Part | What it does |
| --- | --- |
| [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) | Logs, caching, rate limits and spend control for every AI request. |
| [Workers AI](https://developers.cloudflare.com/workers-ai/) | The default provider. No extra API key. Default model: Llama 3.3 70B Instruct (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`). |
| Anthropic or OpenAI | Optional providers through AI Gateway, with your own API key. |
| [AG-UI 1.0](https://docs.ag-ui.com) | The Agent-User Interaction protocol. The agent streams AG-UI events over Server-Sent Events, and approvals use AG-UI interrupts. Types come from `@ag-ui/core` 1.0.4. See [AG-UI](reference/ag-ui.md). |
| Role-based agent access | The agent acts for the person and never exceeds their role. Owners set a per-role AI policy. Risky changes wait for approval, and every action is logged. |
| [Jev](https://typesafe.ai/) by TypeSafe | Optional decision model for the topic check. It answers typed yes-or-no and choice questions about each request, and a truth table in code decides the route. Pinned to `jev-1.14.0`. |
| Topic scope | A small, fast model checks each new request. It sends requests for other projects or new work to the right place and declines anything else. Default model: Llama 3.1 8B Instruct (`@cf/meta/llama-3.1-8b-instruct-fast`). |

## Sign-in and email

There are no passwords. People sign in with a one-time code.

| Part | What it does |
| --- | --- |
| Email codes | A 6-digit code works for 10 minutes and 5 tries. Codes and session tokens are stored only as SHA-256 hashes. |
| [Resend](https://resend.com) | Sends sign-in codes and project invitations through its REST API. |
| Sessions | An `HttpOnly`, `SameSite=Lax` cookie that lasts 30 days. |

## Code

A small set of dependencies. The Worker has one runtime dependency, Hono.

| Part | Version | What it does |
| --- | --- | --- |
| [TypeScript](https://www.typescriptlang.org) | 5.9.3 | Strict mode for the Worker and the web app |
| [Hono](https://hono.dev) | 4.13.16 | The API router on the Worker |
| [React](https://react.dev) | 19.3.1 | The web app. No state library. |
| [shadcn/ui](https://ui.shadcn.com) | New York style | The UI components, copied into `packages/ui/src/components` and owned by this project. Neutral colors. |
| [Radix UI](https://www.radix-ui.com) | 1.8.1 | Accessible parts under the components: dialogs, menus, tooltips, tabs and switches |
| [Tailwind CSS](https://tailwindcss.com) | 4.3.4 | Styles, with the theme as CSS variables in `packages/ui/src/theme.css` |
| [Vite](https://vite.dev) | 8.3.6 | Builds the web app |
| [VitePress](https://vitepress.dev) | 1.6.4 | Builds the docs site at [docs.openact.app](https://docs.openact.app) from the Markdown files in `docs/` |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | 4.158.0 | Local development, migrations and deploys |
| [@ag-ui/core](https://www.npmjs.com/package/@ag-ui/core) | 1.0.4 | AG-UI types, imported as types only |
| Node test runner | Built in | 74 unit tests for app paths, permissions, dates, the AI planner, the AG-UI client, agent access, company access, links, search ranking and the topic check |
| Search pipeline test | Built in | 20 checks that run the real search code and migrations on Node's built-in SQLite, with a stand-in for Vectorize |
| GitHub Actions | | Type checks, tests, a build and a deploy dry run on every push |

## Design

The shadcn/ui design system, with OpenAct's own colors for status, priority and projects.

| Part | What it does |
| --- | --- |
| [Geist](https://fonts.google.com/specimen/Geist) | Text and headings |
| [Geist Mono](https://fonts.google.com/specimen/Geist+Mono) | Dates and the sign-in code |
| [Lucide](https://lucide.dev) | Icons. Outline style with a 2 px stroke, at 16 px in most places. |
| Layout | An app rail and an inset app panel, as in shadcn's sidebar-09 block, and a 48 px page header with the panel toggle, as in dashboard-01 |
| Themes | Light, dark, or follow the system setting |
| Writing | Short, simple sentences in active voice, based on ASD-STE100 Simplified Technical English. American spelling. |

## Source and license

- Source: [github.com/marketgrowth/openact](https://github.com/marketgrowth/openact)
- License: MIT. Copyright (c) 2026 MarketGrowth.
- Maker: [MarketGrowth](https://marketgrowth.io)
