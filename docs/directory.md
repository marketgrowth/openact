---
title: App directory
description: Apps you can add to OpenAct, and the names reserved for official apps.
---

<script setup>
import AppDirectory from "./.vitepress/theme/components/AppDirectory.vue";
</script>

# App directory

OpenAct starts with two apps: Projects and [Docs](docs-app.md). Add more apps from this directory, or [build your own](apps.md). Each app gets sign-in, companies, roles, [permissions](permissions.md) and the app shell from the core.

Install an app by its id:

```bash
npm run openact -- add contacts
npm install
npm run deploy
```

Run `npm run openact -- directory` to see the same list in your terminal.

In the app, select **App directory** below the divider on the app rail. The Apps page shows the apps in the current company and the apps from this directory that you can add. Owners and admins can turn apps on or off there. To show the directory on that page, the host passes it to `createClient`:

```tsx
import directory from "../../directory/apps.json";
createClient({ apps: [...apps, site], directory: directory.apps as DirectoryApp[] });
```

<AppDirectory />

## Reserved names

These ids are reserved for official apps from MarketGrowth: `projects`, `docs`, `timetrack`, `directory`, `profiles`, `groups`, `tasks`, `contacts`, `events`, `learn`, `workflow` and `support`. The app tool installs an app with one of these ids only from its official source.

Some ids are reserved for OpenAct itself, because app ids become table, route and file prefixes. Examples are `core`, `api`, `admin`, `company` and `users`.

If your app needs one of these names, give it a longer id, such as `acme-tasks`. You can still show "Tasks" as its name.

## List your app

Anyone can build an app for OpenAct and list it here.

1. Build the app in a public GitHub repository. Read [Build an app](apps.md) and [Permissions](permissions.md).
2. Tag a release, such as `v1.0.0`.
3. Open a pull request that adds your app to [`directory/apps.json`](https://github.com/marketgrowth/openact/blob/main/directory/apps.json) with the status `available`. The [directory README](https://github.com/marketgrowth/openact/blob/main/directory/README.md) shows each field.
