# Contribute to OpenAct

Thank you for your help. This file tells you how to make a change.

## Before you start

- For a large change, open an issue first. Describe the problem and your plan.
- For a small fix, open a pull request.

## Set up

```sh
npm install
npm run dev
```

Open http://localhost:8787. Sign-in codes print in the terminal.

## Check your change

Run these before you open a pull request:

```sh
npm run typecheck
npm test
npm run build
```

## Rules

- **Database changes.** Core tables: add a new file in `packages/core/migrations/`. Projects tables: add one in `apps/projects/migrations/`. Other apps: in the app's own `migrations/`. Do not edit a migration that is already released.
- **Core or app?** Sign-in, people, companies, roles and the shell belong to the core. Features belong to an app. The core never imports from an app. Read [docs/apps.md](docs/apps.md).
- **Access checks.** Every route that reads or changes a project must call `requireRole` with the lowest role that can do the action. It checks the project role, the company role and the project's visibility together.
- **Sync.** Every change to a project must include `bumpRev` in the same D1 batch, so other open pages reload.
- **One place for business rules.** Put task, column and member logic in `apps/projects/src/server/services.ts`. API routes and the AI agent both call it, so they share the same checks.
- **Secrets.** Never store a raw sign-in code or session token. Never log email contents in production.
- **Text in the app.** Write short, simple sentences in active voice. Use American spelling. Do not use em dashes. Error messages say what went wrong and what to do next.
- **UI components.** Use the shadcn/ui components in `packages/ui/src/components`, imported as `@openact/ui/components/<name>`. To add one, run `npx shadcn@latest add <name>` in `packages/ui`, which reads its `components.json`. Change a copied component only when you must, and say why in the pull request.
- **Styles.** Use Tailwind classes. Do not add a separate stylesheet. Shared rules that classes cannot express go in `packages/ui/src/theme.css`.
- **Themes.** Every color is a token in `packages/ui/src/theme.css`, with a light value and a dark value. Use token classes such as `bg-muted` or `text-priority-high`. Do not use fixed palette colors such as `bg-red-500` or `text-white`.
- **Icons.** Use Lucide icons through the `Icon` component from `@openact/ui`.

## Pull requests

- Keep each pull request to one topic.
- Describe what changed and how you tested it.
- Add screenshots for changes to the web app, in light and dark themes.

## Licenses

Most of OpenAct is under the Apache License 2.0. Paid apps, such as Docs in `apps/docs`, are under the [OpenAct Director License](apps/docs/LICENSE). See [NOTICE](NOTICE) for the list.

- Changes outside the paid app folders: you agree that your work is shared under the Apache License 2.0, as section 5 of the license describes.
- Changes inside a paid app folder: you give MarketGrowth the right to use, change and share your work under any license, as section 3 of the OpenAct Director License says.
