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

- **Database changes.** Add a new file in `migrations/`, such as `0004_add_comments.sql`. Do not edit a migration that is already released.
- **Access checks.** Every route that reads or changes a project must call `requireRole` with the lowest role that can do the action. It checks the project role, the company role and the project's visibility together.
- **Sync.** Every change to a project must include `bumpRev` in the same D1 batch, so other open pages reload.
- **One place for business rules.** Put task, column and member logic in `src/worker/services.ts`. API routes and the AI agent both call it, so they share the same checks.
- **Secrets.** Never store a raw sign-in code or session token. Never log email contents in production.
- **Text in the app.** Write short, simple sentences in active voice. Use American spelling. Do not use em dashes. Error messages say what went wrong and what to do next.
- **Themes.** Every color is a token in `src/client/styles.css`, with a light value and a dark value.

## Pull requests

- Keep each pull request to one topic.
- Describe what changed and how you tested it.
- Add screenshots for changes to the web app, in light and dark themes.

By contributing, you agree that your work is shared under the MIT license.
