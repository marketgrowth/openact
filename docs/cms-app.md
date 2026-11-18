---
title: CMS
description: Open your EmDash CMS admin inside OpenAct, next to the app rail.
---

# CMS

The CMS app (id `cms`) opens your [EmDash](https://github.com/emdash-cms/emdash) CMS admin inside OpenAct. The admin fills the page to the right of the app rail. CMS is a free app.

EmDash keeps its own content, people and sign-in. OpenAct stores only the address of your EmDash site.

## Turn it on

The app is off in each company until an owner or admin turns it on.

1. Go to **Company settings > Apps** and turn on **CMS**.
2. Go to **Company settings > CMS**.
3. Type the address of your EmDash site, such as `https://cms.example.com`, and select **Save**.

You can also paste the admin address, such as `https://cms.example.com/_emdash/admin/`. OpenAct keeps the site part. The address must start with `https://`. For a site on your computer, `http://localhost` works too.

To disconnect the site, select **Remove**.

## Use it

The CMS icon (a long dash) is the last app on the rail, below its own divider. Select it to open the EmDash admin at `<your site>/_emdash/admin/`.

- The app panel closes while the CMS page is open, so the admin sits right of the rail. It opens again when you leave the page. Press Ctrl+B or Cmd+B to open it on the CMS page.
- **Reload** loads the admin again.
- **Open in new tab** opens the admin outside OpenAct.

Sign in to EmDash with your EmDash account. EmDash uses passkeys, and they work in the frame.

## Who sees it

| Permission | Default roles | What it allows |
| --- | --- | --- |
| `cms.use` | Owners, admins | See the CMS page |

Give members the page in **Company settings > Permissions**. Only owners and admins can change the site address.

## Let the EmDash site show in OpenAct

A browser shows a page in a frame only when that page allows it. If the CMS page stays blank, or says that the site refused to connect, the EmDash site does not allow your OpenAct site to frame it.

Allow it on the EmDash site with this response header on `/_emdash/`:

```
Content-Security-Policy: frame-ancestors 'self' https://app.example.com
```

Use your OpenAct address in place of `https://app.example.com`. Remove any `X-Frame-Options` header on those paths.

Sign-in cookies matter too. When EmDash and OpenAct share a domain, such as `cms.example.com` and `app.example.com`, the EmDash sign-in works in the frame. On different domains, many browsers block the EmDash cookie in a frame. Then use **Open in new tab**, or put both sites on the same domain.

## For developers

- Code: `apps/cms/`. The rules for the address are in `src/shared/rules.ts`.
- Table: `cms_settings`, one row per company.
- Routes: `GET /api/apps/cms/companies/:id/site` checks `cms.use`. The address is saved through `PATCH /api/companies/:id` with `{ "emdash": { "siteUrl": "..." } }`.
- The app sets `railPlacement: "end"` and `collapsePanel: true` in its client app. See [The app rail and the app panel](apps.md#the-app-rail-and-the-app-panel).
- The web app's Content-Security-Policy (`public/_headers`) has `frame-src 'self' https:`, because each company frames its own site.
- The frame has a `sandbox`, so the EmDash page cannot navigate the OpenAct page.
