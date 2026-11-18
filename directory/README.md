# The OpenAct app directory

`apps.json` lists the apps that people can add to OpenAct. The docs site shows it at [docs.openact.app/directory](https://docs.openact.app/directory), and the app tool installs from it:

```bash
npm run openact -- directory      # Lists the apps
npm run openact -- add contacts   # Installs an app by its id
```

## Statuses

| Status | What it means |
| --- | --- |
| `built-in` | Part of OpenAct. It is already installed. |
| `available` | Ready to install with `npm run openact -- add <id>` |
| `planned` | The id is reserved for an official app that is not ready yet |
| `example` | An example app in this repository |

## Plans

An entry with `"plan": "director"` or `"plan": "producer"` is a paid app. The directory shows a badge, and the app needs that plan to work. Only official MarketGrowth apps have a plan. Read [Plans](../docs/plans.md).

## Reserved ids

Apps with `"reserved": true` are official apps from MarketGrowth. The app tool installs an app with one of these ids only from its official source. The ids in `systemIds` are reserved for OpenAct itself, because app ids become table, route and file prefixes.

If your app needs one of these names, give it a longer id, such as `acme-tasks`, and keep the name you want in `name`.

## List your app

1. Put your app in a public GitHub repository. Read [Build an app](../docs/apps.md).
2. Tag a release, such as `v1.0.0`.
3. Open a pull request that adds an entry to `apps.json`:

```json
{
  "id": "acme-tasks",
  "name": "Acme Tasks",
  "summary": "One sentence that says what the app does.",
  "category": "Work",
  "status": "available",
  "publisher": "Acme",
  "reserved": false,
  "source": "github:acme/openact-tasks#v1.0.0",
  "repo": "https://github.com/acme/openact-tasks"
}
```

The id must match the `openact.id` in your app's `package.json`. Use an id that no other entry uses.
