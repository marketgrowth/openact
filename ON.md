# The on branch

This branch runs MarketGrowth's private OpenAct at https://on.openact.ing. It has one app: License Keys (`apps/licenses`). Do not merge it into main.

## What it does

- Super admins make Ed25519 key pairs. The Worker makes each pair and seals the private key with `AUTH_SECRET` before it goes into D1. No route sends the private key out.
- Super admins issue license keys with a key pair. The format is the same as `npm run license -- issue`.
- A deploy trusts a key pair only after its public key is in `LICENSE_PUBLIC_KEYS` (`packages/core/src/server/license-keys.ts`) in an OpenAct release. The app shows the line to add, and whether this build has it.
- If `AUTH_SECRET` changes, the sealed private keys stop working. Licenses already issued keep working. Make a new key pair.

## How it deploys

- Cloudflare account: the MarketGrowth account that holds openact.ing.
- Worker: `openact-on` at on.openact.ing. Workers Builds builds this branch on every push.
- Deploy command: `test "$WORKERS_CI_BRANCH" = on && npm run db:migrate:remote && npx wrangler deploy`. It skips `search:setup`, because this deploy has no Vectorize index.
- D1 database: `openact-on`. R2 bucket: `openact-on-files`.
- Secrets in the Worker settings: `AUTH_SECRET` (never change it), `RESEND_API_KEY`. Set them in the dashboard, under Settings, Variables and Secrets.
- Workers Builds: production branch `on`, build command `npm run build`, build token "openact-demo build token", preview builds off.
- Sign-up: only marketgrowth.io emails. Only the super admins in `SUPER_ADMIN_EMAILS` can open License Keys.

## What is different from main

1. `openact.apps.json` installs only `licenses`.
2. `wrangler.jsonc` has the on.openact.ing names, no Docs room and no Vectorize index.
3. `apps/licenses/` and `test/licenses-app.test.ts`.

## Bring main changes here

```sh
git checkout on
git merge origin/main
git push
```

Keep this branch's `openact.apps.json` and `wrangler.jsonc` when they conflict.
