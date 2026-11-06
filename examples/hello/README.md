# Hello: an example OpenAct app

A small app that shows the parts of an OpenAct app: a table, an API route, a page and a side panel item.

- `package.json` has the `openact` field with the app id and its entry files.
- `migrations/0001_notes.sql` creates `hello_notes`. Every row has a `company_id`.
- `src/server/index.ts` adds `/api/apps/hello/companies/:id/notes` and checks the company role.
- `src/client/index.tsx` adds "Notes" to the side panel and the page at `/hello`.

Try it in your OpenAct:

```bash
npm run openact -- add ./examples/hello
npm install
npm run dev
```

To start your own app, copy this folder into its own repository, change the id, and add it with `npm run openact -- add github:owner/repo`. Read [docs/APPS.md](../../docs/APPS.md).
