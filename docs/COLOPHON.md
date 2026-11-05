# Colophon

How OpenAct is made. OpenAct is open source project management with a board, a timeline and a calendar. MarketGrowth makes it and shares it under the MIT license.

The app shows the same page at `/colophon`. Keep the two in step with `package.json` when versions change.

## Platform

OpenAct runs on Cloudflare. One Worker serves the API and the web app.

| Part | What it does |
| --- | --- |
| [Cloudflare Workers](https://developers.cloudflare.com/workers/) | Runs the API and serves the web app as static assets. Compatibility date 2026-10-01, with `nodejs_compat`. |
| [Cloudflare D1](https://developers.cloudflare.com/d1/) | SQLite database for people, projects, members, tasks and sessions. SQL migrations run on every deploy. |
| [Cloudflare R2](https://developers.cloudflare.com/r2/) | Object storage for task attachments, up to 25 MB per file. |
| [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) | A daily job deletes expired sign-in codes and sessions, and expires agent approvals that nobody answered. |
| [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/) | One-click deploy. It creates the database and the bucket, then asks for the secrets. |

## AI

AI features are optional helpers. Every request goes through one gateway.

| Part | What it does |
| --- | --- |
| [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) | Logs, caching, rate limits and spend control for every AI request. |
| [Workers AI](https://developers.cloudflare.com/workers-ai/) | The default provider. No extra API key. Default model: Llama 3.3 70B Instruct (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`). |
| Anthropic or OpenAI | Optional providers through AI Gateway, with your own API key. |
| [AG-UI 1.0](https://docs.ag-ui.com) | The Agent-User Interaction protocol. The agent streams AG-UI events over Server-Sent Events, and approvals use AG-UI interrupts. Types come from `@ag-ui/core` 1.0.4. See [AGUI.md](AGUI.md). |
| Role-based agent access | The agent acts for the person and never exceeds their role. Owners set a per-role AI policy. Risky changes wait for approval, and every action is logged. |

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
| [React](https://react.dev) | 19.3.1 | The web app. No UI framework and no state library. |
| [Vite](https://vite.dev) | 8.3.6 | Builds the web app |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | 4.158.0 | Local development, migrations and deploys |
| [@ag-ui/core](https://www.npmjs.com/package/@ag-ui/core) | 1.0.4 | AG-UI types, imported as types only |
| Node test runner | Built in | Unit tests for dates, the AI planner, the AG-UI client and agent access rules |
| GitHub Actions | | Type checks, tests, a build and a deploy dry run on every push |

## Design

One stylesheet with color tokens for light and dark themes.

| Part | What it does |
| --- | --- |
| [Archivo](https://fonts.google.com/specimen/Archivo) | Headings. A variable font with width and weight axes. |
| [IBM Plex Sans](https://fonts.google.com/specimen/IBM+Plex+Sans) | Body text and controls |
| [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) | Dates, counts and labels, so numbers line up |
| Themes | Light, dark, or follow the system setting |
| Icons and logo | Drawn for OpenAct as inline SVG. No icon library. |
| Writing | Short, simple sentences in active voice, based on ASD-STE100 Simplified Technical English. American spelling. |

## Source and license

- Source: [github.com/marketgrowth/openact](https://github.com/marketgrowth/openact)
- License: MIT. Copyright (c) 2026 MarketGrowth.
- Maker: [MarketGrowth](https://marketgrowth.io)
