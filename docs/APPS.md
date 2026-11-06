# Building OpenAct apps

OpenAct is a core plus apps. The core gives every app sign-in, people, companies, roles, live updates, email, files and the web shell. An app adds the features. Project management is the first app, and it is installed by default.

## How it fits together

```
packages/core      @openact/core   Sign-in, sessions, companies, roles, live rooms, email, the app system
packages/ui        @openact/ui     The web shell, the side panel, sign-in, company settings, shadcn/ui components
apps/projects      @openact/app-projects   Projects, tasks, board, timeline, calendar, AI agent, task search
apps/<your-app>    Your app
src/               The host: the Worker entry, the web app entry, and this deploy's own pages
openact.apps.json  The installed apps, in order
.openact/          Files that `npm run sync` writes from openact.apps.json. Do not edit them.
```

Cloudflare Workers cannot load new code while they run. So apps are added when you build: `npm run sync` writes a list of the installed apps into `.openact/`, and the build includes them.

## Add an app from GitHub

```bash
npm run openact -- add github:owner/repo          # the default branch
npm run openact -- add github:owner/repo#v1.2.0   # a tag or branch
npm install
npm run deploy                                     # or: npm run dev
```

`add` copies the app into `apps/<id>`, the way shadcn/ui copies components: the code is in your repository, and you can read and change it. It adds the app to `openact.apps.json` and copies its migrations into `.openact/migrations/`. The deploy applies them.

Private repositories work when git on your computer can sign in to GitHub.

| Command | What it does |
| --- | --- |
| `npm run openact -- list` | Shows the installed apps and where they came from |
| `npm run openact -- update <id>` | Copies the app again from GitHub. It replaces `apps/<id>`, so keep your own changes in git. |
| `npm run openact -- remove <id>` | Removes the app. Its tables stay in the database, so you can add it again without data loss. |
| `npm run sync` | Writes `.openact/` again. The build, dev and migrate scripts run it for you. |

## Make an app

An app is a folder with a `package.json` that has an `openact` field:

```json
{
  "name": "@acme/openact-app-directory",
  "type": "module",
  "openact": {
    "id": "directory",
    "name": "Directory",
    "server": "./src/server/index.ts",
    "client": "./src/client/index.tsx",
    "migrations": "./migrations",
    "durableObjects": []
  },
  "dependencies": { "@openact/core": "^0.2.0", "@openact/ui": "^0.2.0", "hono": "^4.13.16", "react": "^19.3.1" }
}
```

The `id` is 2 to 31 lowercase letters, numbers or dashes. It must be unique in a deploy.

### Server side

```ts
// src/server/index.ts
import { Hono } from "hono";
import { defineServerApp, requireCompanyRole, requireUser, type AppEnv } from "@openact/core/server";

const routes = new Hono<AppEnv>();
routes.get("/companies/:id/people", async (c) => {
  const user = requireUser(c);
  await requireCompanyRole(c.env, c.req.param("id"), user.id, ["owner", "admin", "member"]);
  const rows = await c.env.DB.prepare("SELECT * FROM directory_profiles WHERE company_id = ?").bind(c.req.param("id")).all();
  return c.json({ people: rows.results });
});

export default defineServerApp({
  id: "directory",
  name: "Directory",
  routes: (api) => api.route("/api/apps/directory", routes),
  hooks: {
    companyMemberRemoved: async (env, companyId, userId) => {
      await env.DB.prepare("DELETE FROM directory_profiles WHERE company_id = ? AND user_id = ?").bind(companyId, userId).run();
    }
  }
});
```

| Part | What it is for |
| --- | --- |
| `routes` | Your API. Use `/api/apps/<id>/...`. The projects app keeps its older paths. |
| `middleware` | Runs on every API request after the session is read |
| `scheduled` | Runs on each cron trigger |
| `hooks.allowSignup` | Lets an email sign up when sign-up is limited, for example because of your app's invitation |
| `hooks.signedIn` | Runs after each sign-in, for example to accept your app's invitations |
| `hooks.companyMemberRemoved` | Remove the person's access to your data in that company |
| `hooks.companyDeleting` | Delete your data and files for that company |
| `hooks.companyCreated` | Set up a new company |
| `hooks.companyDetail`, `hooks.companyUpdate` | Read and save your app's company settings through `/api/companies/:id` |

Live updates: call `registerRoomKind("directory-group", readRevisions)` once, `markChanged("directory-group", id)` when data changes, and `acceptLive()` in a route that checks access first. Pages use `useLive()` from `@openact/ui`.

### Client side

```tsx
// src/client/index.tsx
import { lazy } from "react";
import { defineClientApp } from "@openact/ui";

const DirectoryPage = lazy(() => import("./DirectoryPage"));

export default defineClientApp({
  id: "directory",
  name: "Directory",
  nav: [{ label: "Directory", icon: "users", path: "/directory" }],
  routes: [{ pattern: /^\/directory\/?$/, render: () => <DirectoryPage /> }]
});
```

| Part | What it is for |
| --- | --- |
| `routes` | Pages. Start each one with `SiteHeader` and put its content in `PageBody`. |
| `Home` | The page at `/`. The first app with a home page owns it. |
| `nav` | Items in the side panel, near the top (`main`) or the bottom (`footer`) |
| `SidebarSection` | A block in the side panel, such as the projects list |
| `commands` | Dialogs that open from the side panel or a shortcut, such as Ctrl+K search |
| `companySettingsTabs` | Tabs in Company settings |
| `Provider` | State for your app around the whole shell |
| `publicRoutes` | Pages that work without sign-in |

Use `useShell()` for the person and the config, `useWorkspace()` for the current company, and the shadcn/ui components at `@openact/ui/components/<name>`. Load pages with `lazy()`, so new apps do not slow the first page.

### Migrations

Put numbered SQL files in `migrations/`, such as `0001_init.sql`. `npm run sync` copies them as `<id>_0001_init.sql`. Wrangler applies new files in name order, after the core's files. Your tables may use core tables, such as `users` and `companies`. Core tables never use yours.

## Rules for apps

1. **Prefix everything with your id.** Tables (`directory_profiles`), routes (`/api/apps/directory`), R2 keys (`directory/...`), room kinds and command ids.
2. **Scope your data to a company.** Every row has a `company_id`. Check access with `requireCompanyRole` or your own check built on it.
3. **Use the core for people.** Never read or write `users`, `sessions`, `companies` or `company_members` directly, except for read-only joins. Never handle sign-in yourself.
4. **Follow the UI rules** in AGENTS.md: shadcn/ui components, Tailwind token classes, Lucide icons, `SiteHeader` and `PageBody`.
5. **Clean up through hooks.** When a person leaves a company, or a company is deleted, your hooks remove their access and data.
