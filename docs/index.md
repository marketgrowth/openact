---
layout: home
title: OpenAct docs
hero:
  name: All The World's A Stage
  text: If work is theater and every business a stage, use OpenAct to build, instead of buy, the apps that run your show.
intro:
  title: Build vs. Buy
  text: We propose you build, with agents. Use OpenAct to scaffold your suite of apps. It's open source and it is free to use.
features:
  - title: Projects app included
    details: Manage projects with Kanban, Gantt and calendar views, an AI agent and search. Use it as it is, or as a model for your own app.
    link: /getting-started
  - title: An app directory
    details: Add apps by name. Official apps for time tracking, contacts, events, support and more are under review.
    link: /directory
  - title: A framework for your own apps
    details: Sign-in, companies, roles, permissions, live updates, email, files and the app shell are ready. Your app adds only its own features.
    link: /apps
  - title: Permissions per company
    details: Apps declare what people can do. Company owners choose which roles can do it, and the framework checks every request.
    link: /permissions
  - title: Agents that know their limits
    details: The Projects agent acts for a person and never does more than their role allows. Risky changes wait for approval.
    link: /reference/ag-ui
  - title: Cloudflare from end to end
    details: Workers, D1, R2, Durable Objects, Vectorize and Workers AI, on your own account. Deploy with one click. MIT license.
    link: /colophon
---

<div class="vp-doc home-more">

## What OpenAct gives you

Business apps need the same parts: sign-in, company accounts, roles, invitations, permissions, email and a page layout. OpenAct builds these parts once, in the framework. Each app uses them and does only its own job. A company turns on the apps it needs, and every app works with the same people and companies.

| You get | Where it lives |
| --- | --- |
| Sign-in, sessions and email | The framework core, `@openact/core` |
| Companies, people, roles and invitations | The core |
| Apps on or off per company, and permissions for each role | The core |
| The app rail, side panel, page layout and shadcn/ui components | The UI kit, `@openact/ui` |
| Kanban, Gantt, calendar, AI agent and search | The Projects app |
| Your features | Your app, in `apps/<id>` |

## Build an app in four steps

1. Deploy OpenAct, or run it on your computer. Read [Get started](getting-started.md).
2. Copy the Hello example, or start from [Build an app](apps.md).
3. Declare your [permissions](permissions.md), and check them in every route.
4. Push your app to GitHub. Anyone can add it with `npm run openact -- add github:you/your-app`. [List it in the directory](directory.md#list-your-app).

</div>
