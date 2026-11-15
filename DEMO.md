# The demo branch

This branch runs the public demo at https://openact.ing. Do not merge it into main.

## How it deploys

- Cloudflare account: victor@marketgrowth.io.
- Worker: `openact-demo`. Workers Builds builds this branch on every push.
- Deploy command: `test "$WORKERS_CI_BRANCH" = demo && npm run deploy`. A build of another branch stops before it deploys.
- D1 database: `openact-demo`. R2 bucket: `openact-demo-files`. Vectorize index: `openact-tasks`.
- Secrets in the Worker settings: `AUTH_SECRET`, `OPENACT_LICENSE`, `RESEND_API_KEY`.

## What is different from main

1. `wrangler.jsonc` has the demo names, the `openact.ing` custom domain and the demo vars.
2. `src/server/demo.ts` deletes all data each night at 10:17 UTC when `DEMO_RESET` is `"true"`. It keeps the site settings, the site logo and the migration history.
3. `src/client/DemoNotice.tsx` tells signed-in people that data is deleted each night.
4. `license-keys.ts` has the `demo-openact-ing` key id. It signs one Director license that works on `openact.ing` only and ends on 2027-11-14. Its private key was destroyed after issue. To renew, make a new key pair and license.

## Test a branch on the demo

```sh
git checkout demo
git pull
git merge origin/<branch>
git push
```

To bring the demo up to date with main, merge `origin/main` the same way.
