# OpenAct website

The website at https://openact.ing. It sends people to the demo app at https://a.openact.ing.

This folder is its own project. You can build and deploy it from here. You do not need the rest of the repository to change a page.

## What is here

| Path | What it is |
| --- | --- |
| `src/pages/` | One file for each page. `index.astro` is `/`, `contribute.astro` is `/contribute`, `design.astro` is `/design`, `build.astro` is `/build`, `producer.astro` is `/producer`, `404.astro` is the page for an address that does not exist. |
| `src/layouts/Site.astro` | The layout for marketing pages: head tags, fonts, shared styles, header and footer. |
| `src/components/` | The header, the footer and the logo. `home/` has one file for each home page section. `build/Ideas.astro` is the "What you could build" section that `/build` and `/producer` share. |
| `src/styles/` | `site.css` is shared by every page that uses the layout. Each page has its own file, such as `home.css`. |
| `src/site.ts` | Links that many pages use, such as the demo and the docs. |
| `public/` | Files that are copied as they are: images, `_headers`, `robots.txt`, `sitemap.xml`, `contribute.js`, the Promptbook files. |
| `worker/` | The `openact-site` Worker. It sends www.openact.ing to openact.ing, answers the contribution routes (`/api/contribute`), sends the Producer form (`/api/producer`) and serves the built files. |
| `wrangler.jsonc` | The Worker settings. |

Astro builds the pages into `dist/`. Most pages have no JavaScript. The Contribute page runs `public/contribute.js`, and the Producer page runs `public/producer.js`. The rules in `public/_headers` allow no other script.

## Work on the site

```sh
cd www
npm install
npm run dev       # Astro preview at http://localhost:4321
npm run preview   # Build, then run the real Worker at http://localhost:8787
```

`npm run dev` shows the pages only. Use `npm run preview` to test the Contribute payment routes.

## Add a page

1. Make `src/pages/<name>.astro`. The page is at `https://openact.ing/<name>`.
2. Wrap it in the layout:

   ```astro
   ---
   import Site from "../layouts/Site.astro";
   import "../styles/<name>.css";
   ---
   <Site title="..." description="..." path="/<name>">
     <div class="wrap">...</div>
   </Site>
   ```

3. Put the page's own styles in `src/styles/<name>.css`. Use the variables in `site.css`, such as `var(--accent)` and `var(--muted)`.
4. Add the address to `public/sitemap.xml`.
5. Do not add a `<script>`. The page rules block it. If a page needs a script, add a rule for its path in `public/_headers`, like the one for `/contribute`.

The Promptbook page (`design.astro`) has its own look and does not use the layout. `npm run design -- build` (from the repository root) writes the parts between its `promptbook` markers. Do not edit those parts by hand.

## The Producer form

"Book a scoping call" on `/producer` opens a side drawer with a form (`src/components/build/ScopingDrawer.astro`). The form posts to `/api/producer` (`worker/producer.ts`). The Worker emails the request through [Resend](https://resend.com). Reply-To is the visitor, so you answer them with a plain reply.

Set these on the `openact-site` Worker. Until all three are set, the form says that it is not set up yet.

| Setting | What it does |
| --- | --- |
| `RESEND_API_KEY` | Secret. A Resend API key that can send email. |
| `PRODUCER_TO` | Where requests go. Separate more than one address with commas. |
| `PRODUCER_FROM` | The sender, such as `OpenAct <hello@openact.ing>`. Verify its domain in Resend first. |

```sh
npx wrangler secret put RESEND_API_KEY --config www/wrangler.jsonc
npx wrangler secret put PRODUCER_TO --config www/wrangler.jsonc
npx wrangler secret put PRODUCER_FROM --config www/wrangler.jsonc
```

The form has a honeypot box and a limit of 5 posts per hour from one IP address. Without JavaScript, the drawer still opens and the form still posts.

## Deploy

Workers Builds deploys this folder to the `openact-site` Worker when the `demo` branch changes:

| Setting | Value |
| --- | --- |
| Root directory | `/www` |
| Build command | `npm run build` |
| Deploy command | `test "$WORKERS_CI_BRANCH" = demo && npx wrangler deploy` |
| Build watch paths | include `www/*` and `src/shared/contribute.ts` |

To deploy by hand from your computer:

```sh
cd www
npm install
npx wrangler login
npm run deploy
```

The Worker also uses `src/shared/contribute.ts` from the repository root. Contribution settings are secrets on the `openact-site` Worker. Read `docs/contribute.md`.

## Writing rules

ASD-STE100 style: short sentences, active voice, one idea per sentence. American spelling. No em dashes.
