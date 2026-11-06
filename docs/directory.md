---
title: App directory
description: Apps you can add to OpenAct, and the names reserved for official apps.
---

<script setup>
import AppDirectory from "./.vitepress/theme/components/AppDirectory.vue";
</script>

# App directory

OpenAct starts with one app, Projects. Add more apps from this directory, or [build your own](apps.md). Each app gets sign-in, companies, roles, [permissions](permissions.md) and the app shell from the core.

Install an app by its id:

```bash
npm run openact -- add contacts
npm install
npm run deploy
```

Run `npm run openact -- directory` to see the same list in your terminal.

<AppDirectory />

## Reserved names

These ids are reserved for official apps from MarketGrowth: `projects`, `timetrack`, `directory`, `profiles`, `groups`, `tasks`, `contacts`, `events`, `learn`, `workflow` and `support`. The app tool installs an app with one of these ids only from its official source.

Some ids are reserved for OpenAct itself, because app ids become table, route and file prefixes. Examples are `core`, `api`, `admin`, `company` and `users`.

If your app needs one of these names, give it a longer id, such as `acme-tasks`. You can still show "Tasks" as its name.

## List your app

Anyone can build an app for OpenAct and list it here.

1. Build the app in a public GitHub repository. Read [Build an app](apps.md) and [Permissions](permissions.md).
2. Tag a release, such as `v1.0.0`.
3. Open a pull request that adds your app to [`directory/apps.json`](https://github.com/marketgrowth/openact/blob/main/directory/apps.json) with the status `available`. The [directory README](https://github.com/marketgrowth/openact/blob/main/directory/README.md) shows each field.
