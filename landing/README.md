# OpenAct landing page

The static landing page at https://openact.ing. It sends people to the demo app at https://a.openact.ing.

- `public/index.html` is the page. It has no build step and no JavaScript.
- `src/index.js` sends www.openact.ing to openact.ing and serves the files.
- Workers Builds deploys this folder from the `demo` branch to the `openact-site` Worker. Only changes in `landing/` start a build.

Preview it on your computer:

```sh
npx wrangler dev --config landing/wrangler.jsonc
```

Writing rules: ASD-STE100 style, American spelling, no em dashes.
