---
layout: home
title: OpenAct docs
hero:
  name: OpenAct
  text: The SaaS starter kit for Cloudflare
  tagline: Like MakerKit, but open source and built on Workers, D1, R2 and Durable Objects. Start with the Projects app, then build your own apps.
  image:
    src: /logo.svg
    alt: OpenAct
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Build an app
      link: /apps
    - theme: alt
      text: App directory
      link: /directory
features:
  - title: A ready core
    details: Sign-in with email codes, companies, roles, permissions, live updates, email and files. You do not build them again for each app.
    link: /companies
  - title: Projects app included
    details: Manage projects with Kanban, Gantt and calendar views, an AI agent and search. Use it as it is, or as a model for your own app.
    link: /getting-started
  - title: Anyone can build an app
    details: Build an app with the SDK. Add it to any OpenAct from GitHub with one command, and list it in the directory.
    link: /apps
  - title: Permissions per company
    details: Apps declare what people can do. Company owners choose which roles can do it, and the core checks every request.
    link: /permissions
  - title: An app directory
    details: Official apps for time tracking, contacts, events, support and more are on the way. Their names are reserved.
    link: /directory
  - title: Cloudflare from end to end
    details: Workers, D1, R2, Durable Objects, Vectorize and Workers AI. Deploy to your own account with one click. MIT license.
    link: /colophon
---

<div class="vp-doc home-more">

## Why OpenAct

MakerKit gives teams a head start on Next.js and Supabase. OpenAct gives the same head start on Cloudflare. You get the parts that every SaaS needs, and you spend your time on the app that only you can build.

| You get | Where it lives |
| --- | --- |
| Sign-in, sessions and email | The core, `@openact/core` |
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
