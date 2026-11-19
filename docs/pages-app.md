---
title: Pages
description: Build web pages with an AI writer, edit them in place, and publish them on your own domain. Each page is one HTML file. Forms, images, versions and Google Tag Manager are built in. Part of OpenAct Director.
---

# Pages

Pages is a page builder for your company's website. Each page is one self-contained HTML file: its styles, scripts and images are all in the file. You ask the AI writer for a page, you change the text and images in place, and then you publish. Pages serves the published pages on your own domain, from the same Worker as OpenAct.

::: tip Part of OpenAct Director
Pages is a paid app. It needs a [Director or Producer plan](plans.md). Without a plan, Pages is locked: the Apps page shows it with a **Director** badge and an **Upgrade** button, and your pages stay saved.
:::

Pages replaces the CMS app, which framed an outside EmDash site.

## One site for each workspace

Pages works in [workspaces](workspaces.md). Each workspace is one site, with its own pages, domain and settings. The library shows the pages of the current workspace. The **Images** and **Forms** lists are also for the current workspace.

A company without extra workspaces has one site.

## Install Pages

On sites that MarketGrowth runs, Pages is already installed. On your own deploy, you need a [license key](plans.md#license-keys) and access to the private Director repository. Read [Get the Director apps](plans.md#get-the-director-apps).

```bash
npm run openact -- add pages
npm install
```

Then make sure `wrangler.jsonc` sends every path to the Worker first. Pages needs this to serve `/` on your domain:

```jsonc
"assets": { "run_worker_first": ["/*", "!/assets/*"] }
```

The web app's own pages still come from the static files, with the same security headers.

### Settings for your deploy

| Setting | What it does | Without it |
| --- | --- | --- |
| `CF_ACCOUNT_ID` (variable) | Your Cloudflare account ID | Pages shows the wrangler lines to add a domain by hand. |
| `PAGES_CF_API_TOKEN` (secret) | A Cloudflare API token with **Workers Scripts: Edit** and **Zone: Read** for the zones of your sites. Pages uses it to put a domain on the Worker. | Same as above. |
| `PAGES_WORKER_NAME` (variable) | The name of your Worker | Pages uses `openact`. |
| `PAGES_TURNSTILE_SITE_KEY` and `PAGES_TURNSTILE_SECRET_KEY` (secrets) | A [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) widget for forms | The Turnstile switch is off in site settings. Forms still have a honeypot and a rate limit. |

Set a secret with `npx wrangler secret put PAGES_CF_API_TOKEN`.

## Make a page

1. Choose **Pages** in the app rail.
2. Choose **New page**. Type a title. Pages makes an address from the title, such as `/spring-sale`. You can change it.
3. Choose a folder, a category and tags if you want them.
4. The editor opens with a starter page.

The address `/` is the home page of the site. Some addresses are for the site itself, such as `/robots.txt`, `/sitemap.xml` and `/_img/`. Pages does not let you use them.

## Ask the AI writer

The AI writer floats at the top of the editor. Type what you want, such as "A page for our Q1 workshop with a sign-up form". The writer reads the whole page and writes the whole page again. You see its answer as it writes.

- Each answer saves a new draft version. Choose **Undo** to go back to the version before it.
- The writer cannot publish. You publish when you are ready.
- Select a part of the page first to ask for a change to that part only.
- The writer can use images from the **Images** list.
- The writer does not make up facts, prices, dates or quotes. Where it needs a fact you did not give, it writes a placeholder in square brackets, such as `[EVENT DATE]`, and tells you.

The AI writer follows rules for search engines and AI answers:

- One `h1`, then headings in order
- A title and a description of the right length
- Text that answers questions in the first sentences of a section
- `schema.org` data as JSON-LD, such as `Organization`, `Event`, `Product` and `FAQPage`
- Alt text on images, labels on form fields and links with clear names
- No tracking scripts in the page. Tracking goes in Google Tag Manager.

The writer uses the company's AI. Read [The AI provider of a company](companies.md#the-ai-provider-of-a-company). An admin can turn the writer off for one site in site settings.

## Edit in place

The editor has three modes:

- **Edit.** Click text to change it. Select an element to see its tag, its link or its image. Use the toolbar for bold, italic, links and lists. Choose an image to replace it.
- **HTML.** Change the HTML of the whole page.
- **Preview.** See the page with its scripts on.

In Edit mode, the page's own scripts and event handlers are off, so a script cannot change the page while you edit. They are back on in Preview and on the live site.

Choose **Save draft** to save. When two people edit the same page, the second save shows a message, and nothing is lost. Reload the page to get the latest draft.

### Check the page at other widths

Choose **Desktop**, **Tablet**, **Phone** or **Full** in the toolbar. Or drag the handles at the sides of the page to any width. The width shows above the page.

## Images

You can add images in two ways:

- **In the editor.** Choose an image on the page, then **Replace**. Upload a file or choose one from **Images**.
- **In the Images list.** Upload images for the workspace. The AI writer can use them.

Pages makes each upload smaller before it sends it: up to 2000 pixels wide, as WebP. The largest file is 1 MB. You can upload PNG, JPEG, WebP, GIF and SVG files.

In a draft, images are inside the HTML file. When you publish, Pages moves each image larger than 4 KB into its own file at `/_img/<hash>.<ext>`. Browsers keep these files for a year. The same image on two pages is one file. Pages also adds the width and height to each image, `fetchpriority="high"` to the first image, and `loading="lazy"` to the others.

## Publish

1. Choose **Publish**.
2. Check the address, the title for search engines, the description and the social image.
3. Choose **Publish**.

The page is live at once. The status shows **Published**. When you change a published page, the status shows **Changed** until you publish again. The live page does not change until you publish.

At publish, Pages adds these to the live copy:

- The title, the description and the canonical URL
- Open Graph and Twitter tags for social links
- The Google Tag Manager container of the site
- The form settings: the address that gets the entries, a honeypot field and Turnstile

Choose **Unpublish** to take a page off the site. The page and its versions stay in the library.

### Versions

Each save, AI answer and restore makes a version. Pages keeps the last 10 versions of each page, and also the version that is live. Choose **Versions** to see them. You can open a version, restore it as a new draft, or publish it.

## Forms

Add a form to a page with a key:

```html
<form data-oa-form="signup">
  <label for="email">Work email</label>
  <input id="email" type="email" name="email" required>
  <button type="submit">Sign up</button>
</form>
```

The key has lowercase letters, numbers and dashes. Pages finds the forms when you publish, and shows them under **Forms**. You do not set an action or a method. Pages sets them on the live page.

For each entry, Pages keeps:

- The fields, as text. Files are not kept.
- The page, the referrer, and the UTM values and click IDs of the page address, such as `utm_source` and `gclid`
- The date

Then Pages can:

- **Send an email.** Choose who gets it, up to 5 addresses. The email has a reply-to of the visitor's email when the form has one.
- **Call a webhook.** Pages sends the entry as JSON to an HTTPS address, with an `X-OpenAct-Signature` header. Check it with the secret in the form settings: the header is `t=<time>,v1=<hex>`, and `<hex>` is the HMAC-SHA256 of `<time>.<body>` with the secret.
- **Show a page after the submit.** Choose an address on the same site, such as `/thank-you`. Without one, the form shows a thank-you message in place.
- **Tell Google Tag Manager.** On a submit, the page pushes an `oa_form_submit` event to the `dataLayer`, with the form key.

### See and export entries

Choose **Forms**, then a form. You can mark entries as read or as spam, delete them, and choose **Export CSV**. In the CSV, cells that start with `=`, `+`, `-` or `@` get a `'` in front, so a spreadsheet does not run them as formulas.

### Spam

- A hidden honeypot field. When a bot fills it, the bot gets the usual thank-you answer, and Pages keeps nothing.
- A limit of 8 entries in 10 minutes from one IP address. Pages keeps a hash of the address, not the address.
- Turnstile, when the site has it on

### Keep and forget entries

In site settings, choose how long to keep entries: 90, 180 or 365 days, or always. Pages deletes older entries each day.

To forget a person, choose **Forms**, then **Forget an email**. Type the email address. Pages deletes every entry with that address in the company.

## Site settings

A company owner or admin opens **Company settings > Pages**. There is one card for each workspace.

| Setting | What it does |
| --- | --- |
| Domain | The domain of the site, such as `gtmmatters.com` or `www.gtmmatters.com`. It must not be the domain of OpenAct itself. |
| Google Tag Manager | The container ID, such as `GTM-ABC1234`. Pages adds it to every live page. Put all other tracking in the container. |
| Form email | Who gets form emails when a form has no list of its own |
| Turnstile | Check form entries with Cloudflare Turnstile |
| Keep entries | 90, 180 or 365 days, or always |
| AI writer | Let people use the AI writer on this site |
| Hide from search engines | Adds `noindex` to every page and blocks all crawlers in `robots.txt`. Use it while the site is new. |
| Block AI crawlers | Blocks crawlers that collect text for AI, such as GPTBot and ClaudeBot, in `robots.txt` |

### Add a domain

1. Type the domain, then choose **Save domain**.
2. If your deploy has a Cloudflare API token, Pages puts the domain on the Worker. The domain must be in a zone in the same Cloudflare account. Cloudflare makes the certificate. This can take a few minutes.
3. Without a token, Pages shows the lines to add to `wrangler.jsonc`. Add them, then deploy.

The status shows **Active** after the first visit to the domain.

Each site also has these files:

- `/robots.txt`, with the settings above
- `/sitemap.xml`, with every published page
- `/llms.txt`, a list of the published pages for AI tools
- A 404 page. Publish a page at `/404` to use your own.

## Who can do what

Pages has seven permissions. A company owner or admin can change who has them in Company settings, under Permissions.

| Permission | What it allows | Default roles |
| --- | --- | --- |
| See pages | Open every page, draft and version in the company's sites | Owner, admin, member |
| Edit pages | Make, change and delete pages, upload images, restore versions, and change form fields on a page | Owner, admin, member |
| Use the AI writer | Ask the AI writer to build or change a page. Also needs Edit pages. | Owner, admin, member |
| Publish pages | Put a version of a page live, or take it off the site | Owner, admin, member |
| Organize the library | Make, rename, move and delete folders and categories, rename or delete tags, and move pages to another workspace | Owner, admin |
| See form entries | See, export and delete form entries, and change form emails and webhooks | Owner, admin |
| Manage sites | Change each site's domain, Google Tag Manager container, form settings and search settings | Owner, admin |

Guests do not see Pages.

## Turn Pages off

- **For one company:** a company owner or admin opens **Company settings > Apps**, then turns off Pages. The data stays. The company's sites stop serving pages.
- **For the whole site:** a super admin opens **Site settings**, then turns off Pages under **Apps**.

When a company is deleted, Pages deletes its pages, images and entries, and takes its domains off the Worker.

## How it works

| Part | Where |
| --- | --- |
| Tables | `pages_sites` (one for each workspace), `pages_pages`, `pages_versions`, `pages_messages` (the AI writer chat), `pages_media`, `pages_images` and `pages_live_images` (published image files), `pages_forms`, `pages_form_entries`, and the library tables `pages_folders`, `pages_categories`, `pages_tags`, `pages_page_tags`, `pages_library` |
| Files | R2 under `pages/<company id>/`: `versions/<page id>/<version id>.html`, `live/<page id>.html`, `media/<id>.<ext>`, `img/<hash>.<ext>` |
| Signed-in API | `/api/apps/pages/...` in `apps/pages/src/server/routes-*.ts` |
| Your domain | The core `hosts` hook. Read [Serve your own hostnames](apps.md#serve-your-own-hostnames). Pages answers only for domains in `pages_sites`. |
| The editor | The page shows in an iframe from `/api/apps/pages/pages/<id>/preview`, with a `sandbox` Content Security Policy. The page cannot read OpenAct's cookies or call its API. The editor script talks to the app with `postMessage` and a nonce. |
| Save check | Pages removes scripts from other sites, `<base>` and `<meta http-equiv="refresh">` from each save. Inline scripts stay. |

## Not in Pages yet

- A shared address for each site, such as `<name>.controlcamp.com`, for companies without a domain
- The AI Search Visibility Score from AGEOResearch.com, with a button to fix the page
- Pages that share a header, a footer or styles
- File uploads in forms
- A/B tests
