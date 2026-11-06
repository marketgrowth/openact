# Get started

OpenAct runs on your own Cloudflare account. You need a Cloudflare account and a [Resend](https://resend.com) account for sign-in emails.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/marketgrowth/openact)

## Deploy with one click

1. Click **Deploy to Cloudflare**.
2. Sign in to Cloudflare. Connect GitHub or GitLab. Cloudflare copies this repository to your account.
3. Cloudflare creates the D1 database, the R2 bucket and the Vectorize index for you.
4. Fill in the form:
   - `RESEND_API_KEY`: your [Resend API key](https://resend.com/api-keys).
   - `AUTH_SECRET`: a long random string. Make one with `openssl rand -hex 32`.
   - `EMAIL_FROM`: the sender, for example `OpenAct <no-reply@yourdomain.com>`.
5. Click **Deploy**. The deploy script applies the database migrations, then deploys the Worker.

After the first deploy:

1. In Resend, verify the domain that you use in `EMAIL_FROM`. Without this step, sign-in emails do not arrive.
2. In the Cloudflare dashboard, go to **AI > AI Gateway** and make a gateway named `openact`. If the gateway does not exist, AI requests still work, but without gateway logs and limits.
3. Open your Worker URL. Type your email. The first person can always sign up.
4. Search by meaning needs a Vectorize index with 768 dimensions and a `project_id` metadata index. If search shows "Search by words" only, run `npm run search:setup` once from a copy of the repository. Search by words works without it.

## Deploy by hand

You need Node.js 20 or later and a Cloudflare account.

```sh
git clone https://github.com/marketgrowth/openact.git
cd openact
npm install
npx wrangler login

# Make the database. Copy the database_id from the output into wrangler.jsonc, under d1_databases.
npx wrangler d1 create openact

# Make the file bucket.
npx wrangler r2 bucket create openact-files

# Make the search index (768 dimensions, cosine, with a project_id metadata index).
npm run search:setup

# Add the secrets.
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put AUTH_SECRET

# Set EMAIL_FROM and the other settings in wrangler.jsonc under "vars". Then build and deploy.
npm run build
npm run deploy
```

`npm run deploy` applies new migrations, checks the search index, then deploys. Use it for every update.

## Run it on your computer

```sh
npm install
cp .dev.vars.example .dev.vars   # optional
npm run dev
```

Open http://localhost:8787.

- Without `RESEND_API_KEY`, OpenAct does not send email. It prints each sign-in code in the terminal.
- `npm run dev` runs fully local, so AI assist and search by meaning are off. Search by words still works. To use AI on your computer, run `npx wrangler login`, then `npm run dev:ai`.
- For hot reload of the web app, run `npx wrangler dev --local` in one terminal and `npm run dev:ui` in a second terminal. Then open http://localhost:5173.

Other commands:

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Checks the types of the Worker and the web app |
| `npm test` | Runs the unit tests |
| `npm run test:search` | Runs the search pipeline test: real migrations in SQLite, with fake Vectorize and Workers AI |
| `npm run search:setup` | Creates the Vectorize index and its metadata index. Safe to run again. |
| `npm run build` | Builds the web app into `dist/client` |
| `npm run db:migrate:local` | Applies migrations to the local database |
| `npm run db:migrate:remote` | Applies migrations to the Cloudflare database |

## Settings

Set these under `vars` in `wrangler.jsonc`, or in the Cloudflare dashboard.

| Name | Default | What it does |
| --- | --- | --- |
| `APP_NAME` | `OpenAct` | The name in the app and in emails |
| `APP_URL` | empty | The public URL used in email links. Empty means the URL of the request. |
| `EMAIL_FROM` | `OpenAct <no-reply@example.com>` | The sender address. The domain must be verified in Resend. |
| `SIGNUP_MODE` | `open` | `open`: anyone can sign up. `invite`: only invited people can sign up. |
| `ALLOWED_EMAIL_DOMAINS` | empty | A comma-separated list of domains that can sign up, for example `example.com,example.org` |
| `AI_PROVIDER` | `workers-ai` | `workers-ai`, `anthropic` or `openai` |
| `AI_MODEL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | The model ID for the provider |
| `AI_EMBED_MODEL` | `@cf/baai/bge-base-en-v1.5` | The Workers AI model for search embeddings. It must make 768-dimension vectors. |
| `AI_SCOPE_MODEL` | (empty) | A small, fast model for the topic check. Empty uses `@cf/meta/llama-3.1-8b-instruct-fast`, `claude-haiku-5-5` or `gpt-4.1-mini`, by provider. |
| `AI_GATEWAY_ID` | `openact` | The AI Gateway name. Empty turns the gateway off. |
| `CF_ACCOUNT_ID` | empty | Your account ID. Needed for `anthropic` and `openai`. |
| `TYPESAFE_MODEL` | `jev-1.14.0` | The Jev release for the topic check. Pinned, because the thresholds are set for it. |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | Another URL for the TypeSafe API, such as a gateway |

Set these secrets with `npx wrangler secret put NAME`:

| Secret | Needed | What it does |
| --- | --- | --- |
| `RESEND_API_KEY` | Yes | Sends sign-in codes and invitations |
| `AUTH_SECRET` | Yes | Protects stored sign-in codes. Use 32 or more random characters. |
| `ANTHROPIC_API_KEY` | For `anthropic` | Anthropic API key, sent through AI Gateway |
| `OPENAI_API_KEY` | For `openai` | OpenAI API key, sent through AI Gateway |
| `AI_GATEWAY_TOKEN` | No | Needed only if your AI Gateway uses authentication |
| `TYPESAFE_API_KEY` | No | Turns on Jev for the topic check. Get a key from TypeSafe. |

The first person to sign in can always make an account, even in `invite` mode. An invitation always lets that email sign up, even when `ALLOWED_EMAIL_DOMAINS` does not include its domain.

## How sign-in works

1. A person types their email. OpenAct makes a random 6-digit code and sends it with Resend.
2. The code works for 10 minutes and for 5 tries. Only the newest code works.
3. When the code is correct, OpenAct sets a session cookie for 30 days. The cookie is `HttpOnly` and `SameSite=Lax`, and `Secure` on HTTPS.
4. Pending project and company invitations for that email become memberships. If a company claimed the email's domain, the person joins it as a member.

OpenAct stores only SHA-256 hashes of codes and session tokens. It limits code requests to 5 for each email in 15 minutes and 30 for each IP address in one hour. A daily cron job deletes old codes and sessions.
