# Orbytt mockup

A mockup of the Orbytt app inside OpenAct. It shows how a second app looks in the app rail, with its own panel and pages.

- It is web code only. It has no server, no tables and no API calls.
- The talent, shortlists and contractors are sample data. Nothing is saved.
- The real Orbytt app will call the Orbytt API on orbytt.ai from the Worker, with a key for each company.

Try it:

```bash
npm run openact -- add ./examples/orbytt
npm run dev
```

The app starts off in every company. A company owner or admin turns it on in Company settings, on the Apps tab.

Remove it with `npm run openact -- remove orbytt`.
