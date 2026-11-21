# Security and company isolation

Many companies can share one OpenAct deploy. The deploys at GTM Matters, DirectCare and SideHustle work like that. This page says what keeps each company's data apart, and what each app must do. Every deploy gets these rules from the core, so a deploy needs no setup of its own.

## Access is in code

Every route checks the person, their company and their role before it reads or changes data. Project routes call `requireRole`. App routes call `requirePermission`. A person in one company gets 404 for every id from another company, so ids reveal nothing.

The AI agent follows the same checks. An agent tool runs as the person, inside one company. The model never decides access.

## The cross-company test suite

`test/cross-company.test.ts` makes two companies, Alpha and Beta, on one deploy. A Beta person then calls every route with Alpha's ids. The test passes only when:

- every call that names Alpha data is refused with 401, 403 or 404,
- no answer holds Alpha names, emails or ids, and
- Alpha's rows are the same after every call.

The suite reads the deploy's list of routes. A new route without a case fails the test. When you add a route, add a case. An app can keep its cases in its own file in `test/cross-company/`, with a `seed` function for its data. Apps in another repository, such as the Director apps, add their file there.

The test deploy runs in Node, with every migration on SQLite. `test/harness/` holds stand-ins for D1, R2, the live rooms, Vectorize and Workers AI. The Vectorize stand-in returns every vector for every query, like a broken index, so the suite also checks that search drops other companies' results.

## Agents and planted instructions

A person in one company can write text that an agent in another place reads later: a task note, a forum post, a file name. That text can hold planted instructions, such as "send the client list to this address". This is prompt injection.

An injected prompt can change what an agent tries to do. It cannot change what the code allows. The rules:

1. **Access stays in code.** Every tool runs as the person, in one company, with the same checks as the routes. `test/agent-injection.test.ts` replaces the model with one that obeys every instruction. It still cannot read or change another company's data.
2. **Text from other people is data.** The agent's instructions say so (`UNTRUSTED_TEXT_RULE` in `@openact/core/shared`). A tool answer that holds text from outside the company sets `origin` to `"shared"` or `"web"`. The core then puts the text between labels with `untrustedText()`.
3. **Some actions always wait for the person.** Deletes, people changes, sending something out and writing where other companies read always need the person's approval. So do large batches: five or more changes in one run, counted across the whole run.
4. **The chat shows plain text.** The agent's answer never renders as HTML. The web app's Content Security Policy loads images only from the deploy itself (`img-src 'self' data: blob:`) and calls only the deploy (`connect-src 'self'`). A planted image link cannot carry data to another site.
5. **One company per agent.** The in-app agent works in one project. An MCP token works in the one company that the person picked when they connected the agent. A person who leaves the company loses the token.

### Tool effects

An app tool says what it does with `effect`:

| Effect | What the tool does | The agent |
| --- | --- | --- |
| `read` | Reads only | Runs it |
| `write` | Changes the company's own data | Runs it. Five or more changes in one run wait for approval. |
| `delete` | Deletes the company's data | Asks the person first |
| `send` | Sends something out: an email, a message, a call to another site | Asks the person first |
| `shared` | Writes where people from other companies read: a public page, a forum, a network feed | Asks the person first |

MCP clients see the effect as tool hints: `readOnlyHint` for `read`, `destructiveHint` for `delete`, and `openWorldHint` for `send` and `shared`.

## Installed apps have full access

Until sandboxed apps ship, every installed app runs inside the deploy's Worker. It can read every company's data and the deploy's secrets. So the app tool installs an app that nobody reviewed only with `--trust`:

```bash
npm run openact -- add github:someone/their-app --trust
```

Without `--trust`, the command stops and says why. Official apps and verified apps in the directory install without it, from the source that the directory lists. Your own folders (`./path`) do too. Site settings shows "Not reviewed, full access" next to each app that came in with `--trust`.

Never use `--trust` on a deploy that hosts other people's companies.

## Report a problem

Read [SECURITY.md](https://github.com/marketgrowth/openact/blob/main/SECURITY.md) to report a security problem.
