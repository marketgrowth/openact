# The demo branch

This branch runs the public demo app at https://a.openact.ing and the landing page at https://openact.ing. Do not merge it into main.

## How it deploys

- Cloudflare account: victor@marketgrowth.io.
- App Worker: `openact-demo` at a.openact.ing. Workers Builds builds this branch on every push.
- Landing Worker: `openact-site` at openact.ing and www.openact.ing (www redirects to openact.ing). Its files are in `www/`, an Astro project. A second Workers Builds project builds and deploys it from this branch, with `/www` as the root directory and `npm run build` as the build command. Read `www/README.md`.
- Deploy command: `test "$WORKERS_CI_BRANCH" = demo && npm run deploy`. A build of another branch stops before it deploys.
- Docs Worker: `openact-docs-demo` at docs.openact.ing. A third Workers Builds project builds `docs/` from this branch with `npm run docs:build`, then runs `npx wrangler deploy --config wrangler.docs.jsonc`. On main, the same docs deploy to docs.openact.app through GitHub Actions. All three Workers use the build token "openact-demo build token".
- D1 database: `openact-demo`. R2 bucket: `openact-demo-files`. Vectorize index: `openact-tasks`.
- Secrets in the Worker settings: `AUTH_SECRET`, `OPENACT_LICENSE`, `RESEND_API_KEY`.
- Contribution secrets (`STRIPE_SECRET_KEY`, `STRIPE_PORTAL_URL`, `X402_*`) belong on the landing Worker, `openact-site`, not on `openact-demo`. Read `docs/contribute.md`.

## What is different from main

1. `wrangler.jsonc` has the demo names, the `a.openact.ing` custom domain and the demo vars.
2. `src/server/demo.ts` deletes all data each night at 10:17 UTC when `DEMO_RESET` is `"true"`. It keeps the site settings, the site logo, the sign-in background and the migration history. It also keeps each company named in `DEMO_KEEP_COMPANIES` ("MarketGrowth") when a super admin owns it, with its data, files, people and their sessions. A visitor's company with the same name is deleted.
3. `src/client/DemoNotice.tsx` tells signed-in people that data is deleted each night.
4. `license-keys.ts` has the `demo-a-openact-ing` key id. It signs one Director license that works on `a.openact.ing` only and ends on 2027-11-14. Its private key was destroyed after issue. To renew, make a new key pair and license.

5. `wrangler.docs.jsonc` and the sitemap host in `docs/.vitepress/config.mts` point at docs.openact.ing.
6. `www/` is the website and its Worker. Edit the pages in `www/src/pages/` and the home page sections in `www/src/components/home/`. Astro builds them into `www/dist/`. The Worker (`www/worker/`) runs the contribution routes at `/api/contribute`.

## Test a branch on the demo

```sh
git checkout demo
git pull
git merge origin/<branch>
git push
```

To bring the demo up to date with main, merge `origin/main` the same way.
