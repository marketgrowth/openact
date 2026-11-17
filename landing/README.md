# OpenAct landing page

The landing page at https://openact.ing. It sends people to the demo app at https://a.openact.ing.

- `public/index.html` is the home page. It has no build step and no JavaScript.
- `public/contribute.html` is the Contribute page at https://openact.ing/contribute. The main menu links to it. Its one script is `public/contribute.js`.
- `src/index.ts` sends www.openact.ing to openact.ing, answers the contribution routes (`/api/contribute`, in `src/contribute.ts`) and serves the files.
- Contribution settings are secrets on the `openact-site` Worker. Read `docs/contribute.md`.
- Workers Builds deploys this folder from the `demo` branch to the `openact-site` Worker. Only changes in `landing/` start a build. The Worker also uses `src/shared/contribute.ts`. After you change that file, change a file in `landing/` too, or redeploy by hand.

Preview it on your computer:

```sh
npx wrangler dev --config landing/wrangler.jsonc
```

Writing rules: ASD-STE100 style, American spelling, no em dashes.
