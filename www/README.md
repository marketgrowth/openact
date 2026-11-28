# OpenAct website

The website at https://openact.ing. It sends people to the demo app at https://a.openact.ing.

This folder is its own project. You can build and deploy it from here. You do not need the rest of the repository to change a page.

## What is here

| Path | What it is |
| --- | --- |
| `src/pages/` | One file for each page. `index.astro` is `/`, `contribute.astro` is `/contribute`, `design.astro` is `/design`, `build.astro` is `/build`, `producer.astro` is `/producer`, `404.astro` is the page for an address that does not exist. |
| `src/layouts/Site.astro` | The layout for marketing pages: head tags, fonts, the theme, header and footer. |
| `src/components/` | The header, the footer and the logo. `ui/` holds the shadcn/ui-style parts (Button, Badge, Heading, Faq, Window, ThemeSwitcher). `art/` holds the dithered WebGL canvases and line shapes. `home/` has one file for each home page section. `build/` holds the parts that `/build` and `/producer` share, such as `Ideas.astro` ("What you could build"). |
| `src/styles/` | `global.css` holds Tailwind CSS and the theme tokens, in shadcn/ui names (`background`, `foreground`, `muted`, `muted-foreground` and more), for the light and dark themes. `drawer.css` and `contribute.css` belong to one part each. |
| `src/scripts/` | Scripts that components share, such as `tabs.ts`. |
| `scripts/` | `make-art.py` makes the still dithered pictures in `public/images/art/`. `check-orphans.py` checks for orphan words. |
| `src/site.ts` | Links that many pages use, such as the demo and the docs. |
| `public/` | Files that are copied as they are: images, `_headers`, `robots.txt`, `sitemap.xml`, `theme.js`, `contribute.js`, `producer.js`, the Promptbook files. |
| `worker/` | The `openact-site` Worker. It sends www.openact.ing to openact.ing, answers the contribution routes (`/api/contribute`), sends the Producer form (`/api/producer`) and serves the built files. |
| `wrangler.jsonc` | The Worker settings. |

Astro builds the pages into `dist/`. The rules in `public/_headers` allow scripts from this site only, never inline scripts. So `astro.config.mjs` sets `assetsInlineLimit: 0`, and Astro writes every component script to `/_astro/` as a file.

## The look and the themes

The design follows the Buio theme by Lexington Themes: a near black page with white ink, hairlines between sections, two-tone headings and dithered art. The light theme turns it around: white paper and near black ink.

- **Tokens.** Use Tailwind classes with the tokens in `src/styles/global.css`, such as `bg-background`, `text-muted-foreground` and `border-muted`. Never use fixed colors such as `text-white`. Each token has a light and a dark value.
- **Theme switcher.** `public/theme.js` loads first in `<head>`. It puts `.light` or `.dark` on `<html>` before the page paints, and keeps the choice (Light, Dark or System) in localStorage. Buttons with `data-theme-toggle` or `data-theme-set` need no other script. Without JavaScript, the page follows the system setting.
- **Pictures for one theme.** Give an image the class `only-light` or `only-dark`. The product screenshots in the tour use this.
- **Dithered art.** The canvases in `src/components/art/` and the pictures in `public/images/art/` draw light dots. The `dither` class turns them dark on the light theme.
- **Headings.** Use `ui/Heading.astro`. The first line is in the foreground color. Pass the second line as `muted`.
- **Fonts.** IBM Plex Sans and IBM Plex Mono, the OpenAct website fonts. Buio uses Switzer and Geist Mono.

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
   import Wrapper from "../components/ui/Wrapper.astro";
   ---
   <Site title="..." description="..." path="/<name>">
     <Wrapper class="pt-32 pb-24">...</Wrapper>
   </Site>
   ```

3. Style the page with Tailwind classes and the tokens in `src/styles/global.css`. Reuse the parts in `src/components/ui/` first.
4. Add the address to `public/sitemap.xml`.
5. A script goes in a component `<script>` tag, which Astro writes to a file. Never use `is:inline` with code inside it: the page rules block inline scripts. A page that calls an API or posts a form needs its own rule in `public/_headers`, like the ones for `/contribute` and `/producer`.

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

No orphan words: a heading or a paragraph never ends with a single word alone on its last line. `src/styles/global.css` sets `text-wrap: balance` on headings and `text-wrap: pretty` on text. `integrations/no-orphans.mjs` also binds the last two words of each heading, paragraph and list item with a no-break space when the site builds. Do not turn these off. If a heading still leaves one word alone at some width, shorten it or set a narrower `max-width` on it. Run `npm run build`, then `python3 scripts/check-orphans.py`. It opens every page at ten widths and fails when a block of text ends with one word alone.
