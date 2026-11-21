---
title: Plans
description: OpenAct is free and open source. OpenAct Director and OpenAct Producer add paid apps, with one annual price per company.
---

# Plans

The OpenAct core, the UI and the Projects app are free and open source. Paid apps come with a paid plan. Docs, Advisory and eSign are the paid apps today.

| Plan | For | What you get |
| --- | --- | --- |
| **Free** | Everyone | The core, the UI and the [Projects](getting-started.md) app, under the Apache License 2.0 |
| **Director** | Growing organizations | Everything in Free, plus [Docs](docs-app.md), [Advisory](advisory-app.md) and [eSign](esign-app.md). More paid apps will join Director. |
| **Producer** | Custom apps as a service | Everything in Director. A done-for-you service: we install and manage OpenAct, and we work with you to build your primary custom app. |

Each paid plan has one annual price per company. The price does not change with the number of people. Choose Director to build your own apps. Choose Producer when you want us to do the work.

Nonprofits get 50% off Director and Producer.

## Get the Director apps

The paid apps are in a private repository, `marketgrowth/openact-director`. The public OpenAct repository has the core, the UI and Projects only.

- **Sites that MarketGrowth runs:** the paid apps are already installed. Buy a plan in **Site settings > Plan**.
- **Your own deploy:** buy and install from your site. Read [Buy and install from your site](#buy-and-install-from-your-site).
- **Your own deploy, by hand:** MarketGrowth gives you two things with your plan: a license key, and read access to the private repository for one GitHub account. Then install each app:

  ```bash
  npm run openact -- add docs       # or advisory, esign
  npm install
  npm run deploy
  ```

  `add` copies the app into `apps/<id>` in your repository. Keep your repository private: the OpenAct Director License does not let you share the paid apps. Each app's page says what else to add to `wrangler.jsonc`.

To get new versions of apps you added by hand, run `npm run openact -- update <id>` while your license is current. Read [When a plan ends](#when-a-plan-ends).

## Buy and install from your site

A site that runs on your own Cloudflare account can buy Director and install its apps from **Site settings > Plan**, in **License and Director apps**. Only super admins see it. The site's Worker talks to the OpenAct store at on.openact.ing.

Before you start:

- Set `APP_URL` to the site's address, such as `https://app.example.com`. A license from the store works only on that host.
- Keep the site's code in a **private** GitHub repository, with Cloudflare Workers Builds deploying it. A site made with the Deploy to Cloudflare button already has both. Make the repository private if it is public.
- Keep the deploy command that runs the database migrations, such as `npm run deploy`.

### Buy

1. Choose **Buy Director**. Stripe Checkout opens. Nonprofits can use their promotion code there.
2. Pay. Stripe sends you back to the Plan page.
3. The site gets its license key from the store and saves it. The paid apps unlock.

The store sends a new key each time the plan renews. The site fetches it once a day. If you stop the plan, the last key ends, and the [perpetual fallback](#perpetual-fallback-on-your-own-deploy) keeps the app versions you have.

The site proves that it made the order with a claim token. The token stays in the site's Worker, sealed with `AUTH_SECRET`. The browser never sees it.

### Add a key by hand

If MarketGrowth sent you a license key, choose **Add a license key**, paste it and choose **Save the key**. It does the same as the `OPENACT_LICENSE` secret. When both are set, the key that works and lasts longer wins.

### How the store link works

A license key alone cannot install apps from the store. The store also needs the site's claim token, so a copied key is not enough. A site that bought through the store has a claim token from checkout. A site with a key from MarketGrowth links itself:

1. The site makes a claim token and seals it with `AUTH_SECRET`. The token never leaves the Worker except to the store.
2. The site sends the store its key, its host (from `APP_URL`) and the link code. The link code is the SHA-256 of the token. Nobody can find the token from it.
3. The store reads `https://<host>/api/site/director/link-proof`. When that page shows the same link code, the request came from the site on that host, and the store links the key.
4. A key that names no host waits until MarketGrowth approves the link in License Keys.

The site links itself once a day and before each install, so nobody has to do it by hand. **Link to the store** on the Plan page does it at once. After the link, the site fetches renewed keys by itself, the same as a store order. If the site loses its token, for example after a database restore, it makes a new one and links again.

### Install or update the apps

1. Choose **Connect GitHub**. GitHub asks you to install the **OpenAct Director** app. Give it only the repository of this site.
2. Back on the Plan page, choose the repository. Leave the branch empty to use the branch that Cloudflare deploys.
3. Choose the apps, then **Install**.

The store checks your license. Then it makes one commit in your repository:

- Each app goes to `director/<id>/`, as a prebuilt bundle with its migrations and its license. Your `package-lock.json` does not change.
- `openact.apps.json` lists the app with the source `director` and its version.
- `wrangler.jsonc` gets the lines the app needs, such as the `DOCS_ROOMS` Durable Object and the `/docs/s/*` share links for Docs.
- An app that was in `apps/<id>/` from an older OpenAct moves to `director/<id>/`. Its data stays.

Cloudflare builds and deploys the commit. The apps show up after the build, in a few minutes. If the branch is protected, the store opens a pull request instead. Merge it to deploy.

When the store has a newer version, the Plan page shows **Update from** next to the app. Install it the same way.

| Setting | What it does |
| --- | --- |
| `APP_URL` | The site's address. Store keys work only on its host. |
| `OPENACT_STORE_URL` | Optional. Another store, for tests. Empty uses `https://on.openact.ing`. |
| `OPENACT_LICENSE` | Optional. A license key as a secret. Site settings > Plan can hold the key instead. |

## Get a plan

There are two ways to get a plan. A super admin can also [give one person a paid app](#give-one-person-a-paid-app).

- **The site plan:** the owner of the site chooses a plan in **Site settings > Plan**. Stripe takes the payment. Every company on the site gets the plan as soon as Stripe confirms it. Read [The site plan](#the-site-plan).
- **On your own deploy:** MarketGrowth gives you a license key. Put it in the `OPENACT_LICENSE` secret. Every company on the deploy gets the plan in the key.

When a company has both, it gets the higher plan.

### The site plan

The super owner is the owner of the brand that runs the site. In OpenAct, that is a super admin (an email in `SUPER_ADMIN_EMAILS`) who is an **owner** of a company.

When the super owner pays for a plan in their own company, that plan becomes the site plan. Every company on the site gets its paid apps.

- Only the super owner can buy a plan. Company owners and admins do not see the Plan page.
- Each company still turns apps on or off in **Company settings > Apps**.
- When the site plan stops, the paid apps lock in every company that has no plan of its own. Their data stays.

The site plan follows the same rules as any subscription: past_due keeps it, and it works 7 days after the paid year ends.

### The Plan page

The Plan page is in Site settings. Only super admins see it.

1. Open **Settings** with the gear at the bottom of the app rail.
2. Under **Site settings**, choose **Plan**.

The page shows the plan of a company that you own: the current company when you own it, or else the first one. You need to own a company to buy a plan. The page shows:

- the plan, and when it renews or stops
- the plans for sale on this site, with their prices
- the apps in each plan

In the app, the plans are named **Director** and **Producer**, so the names fit any brand that runs OpenAct.

Only a super admin who owns the company can buy a plan. The server checks it on every checkout. Choose **Manage billing** to change the card, see invoices, switch between Director and Producer, or cancel. A canceled plan works until the end of the paid year.

## When a plan ends

What happens depends on who runs the site.

| Where OpenAct runs | How you pay | When the plan ends |
| --- | --- | --- |
| A site that MarketGrowth or a brand runs, such as a hosted OpenAct | A yearly subscription through Stripe | The paid apps lock. Their data stays. They come back when the plan comes back. |
| Your own deploy (self-hosted) | A license key for one year | **Perpetual fallback:** the paid app versions that you have keep working. You stop getting new versions and new paid apps until you renew. |

### Perpetual fallback on your own deploy

A license key buys one year of updates for the paid apps. Each paid app version has a release day (`"released"` in its manifest).

- When the key ends, an app version released on or before the key's last day keeps working.
- A newer version stays locked. If you install a newer version after your key ends, renew the key to unlock it.
- A paid app that you install after your key ends stays locked.
- Grants stop when the key ends. Read [Give one person a paid app](#give-one-person-a-paid-app).
- The Plan page says that the license ended, and which apps still work.

Renew the key to get updates again. A renewed key covers every version released up to its new last day.

::: info Why it works this way
On your own deploy, the code runs on your Cloudflare account. The fallback is fair to you: you keep what you paid for. Updates, new apps and support are what you renew for.
:::

## What happens without a plan

An app that needs a plan is **locked** in a company without that plan.

- **Company settings > Apps** shows the app with a **Director** badge. The switch is off and cannot be turned on.
- The app leaves the app rail. Its pages say that it is part of a paid plan, and ask people to talk to the owner of the site.
- Its API routes answer with the code `plan_required`.
- For Docs: share links stop working, and live editing closes.

The app's data stays. When the company gets the plan again, the app comes back with all its data.

On your own deploy, an ended license key keeps the paid app versions that you have. Read [Perpetual fallback](#perpetual-fallback-on-your-own-deploy).

If a payment fails, the plan keeps working while Stripe tries the card again. After the paid year ends, the plan keeps working for 7 more days, in case a message from Stripe is late.

### Change the plan descriptions

A super admin can change the sentence under each plan name on the Plan page. Use it to describe the plans in the words of your brand, such as "For homes with up to 15 beds."

1. Open **Settings**, then **Site settings > Plan**.
2. Choose the pencil button next to the description of **Free plan**, **Director** or **Producer**.
3. Type the new description, then choose **Save**. Use 200 characters or fewer.
4. To show the default text again, choose **Use default**.

The Free plan description shows only when the site has no plan. The server checks that the person is a super admin on every save (`PATCH /api/site/plans/:planId`).

## Give one person a paid app

A super admin can give a paid app to one person without a paid plan. Use it for a partner, a beta tester or a nonprofit.

Grants need a license key from MarketGrowth in `OPENACT_LICENSE`. A super admin can grant only the apps in the key's plan. Without a key, **Paid app access** says that the site needs one. To allow grants without giving every company the plan, use a key made with `--use grants`. Read [License keys](#license-keys).

1. Open **Settings** with the gear at the bottom of the app rail.
2. Under **Site settings**, choose **Paid app access**. Find the person by name or email.
3. Turn on the app, such as **Docs**.
4. Optional: set an end day. The grant works through the whole of that day (UTC). Leave it empty to keep it on.

What the grant does:

- The app unlocks in every company where the person is an **owner**. Everyone in that company can use it, with the permissions of their role.
- A grant to a person who owns no company does nothing until they make or own one.
- A grant to an admin, member or guest does not unlock their company. Give it to an owner of the company.
- The company switch still applies. If the app starts off, a company owner or admin turns it on in **Company settings > Apps**. The Apps page says the app was given by a site admin.
- When the grant ends or a super admin turns it off, the app locks again in those companies. Its data stays.
- A site switch that is off wins over a grant.

Grants are in the `app_grants` table (migration `0009_app_grants.sql`). Only super admins can read or change them.

## Sell plans on your site

MarketGrowth sells plans on the OpenAct sites that it runs. To set this up on a site:

1. In Stripe, make a product for each plan, with a yearly price. Copy each price id (`price_...`).
2. Set these variables:

   | Name | Value |
   | --- | --- |
   | `STRIPE_PRICE_DIRECTOR` | The price id of Director |
   | `STRIPE_PRICE_PRODUCER` | The price id of Producer. Leave it empty to sell only Director. |
   | `PLANS_CONTACT_URL` | Optional. A `https://` or `mailto:` link. The Plan page shows **Talk to us** for a plan that is not for sale. |

3. Set the secrets with `npx wrangler secret put NAME`:

   | Secret | Value |
   | --- | --- |
   | `STRIPE_SECRET_KEY` | Your Stripe secret key, or a restricted key that can write Checkout Sessions and billing portal sessions, and read prices and subscriptions |
   | `STRIPE_WEBHOOK_SECRET` | The signing secret of the webhook in step 4 |

4. In Stripe, add a webhook endpoint at `https://<your site>/api/billing/stripe-webhook`. Send these events: `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`.
5. In Stripe, turn on the customer portal, and let customers switch between the two prices.

Promotion codes work at checkout. Use a 100% code to give a plan to a nonprofit for free.

A company with a plan that renews cannot be deleted. Cancel the plan first.

::: warning
The OpenAct Director License does not let you sell plans to yourself or to others with your own Stripe account. On your own deploy, use a license key from MarketGrowth.
:::

## License keys

A license key is a signed text that starts with `oa1.`. It names the licensee, the plan, the last day and, if you want, the host names where it works and its use.

| Use | What the key does |
| --- | --- |
| `plan` (the default) | Every company on the deploy gets the plan. Super admins can also give the plan's apps to one person. |
| `grants` | No company gets the plan. Super admins can give the plan's apps to one person at a time. Use it on a site that sells plans with Stripe. |
 The core checks the signature with the public keys in `packages/core/src/server/license-keys.ts`. It needs no network.

To use a key:

```bash
npx wrangler secret put OPENACT_LICENSE
```

Set `APP_URL` too when the key names host names, so the core knows the host.

After the last day, the key keeps working for 14 more days, and the Plan page asks for a new key. Then the key ends. Read [When a plan ends](#when-a-plan-ends).

### Make keys (MarketGrowth)

```bash
# Once: make a key pair. The private key goes outside the repository.
npm run license -- keygen --kid mg-2026

# For each customer:
npm run license -- issue --key ~/.openact/license-mg-2026.pem --kid mg-2026 \
  --licensee "Acme Inc." --plan director --expires 2027-11-10 --hosts app.acme.com

# For a site that sells plans, so super admins can give paid apps to one person:
npm run license -- issue --key ~/.openact/license-mg-2026.pem --kid mg-2026 \
  --licensee "GTM Matters" --plan director --expires 2027-11-10 --hosts app.gtmmatters.com --use grants

# Read a key:
npm run license -- inspect oa1....
```

`keygen` prints the public key. Add it to `LICENSE_PUBLIC_KEYS` in `packages/core/src/server/license-keys.ts` under its key id, then release OpenAct. Keep old key ids while their licenses are in use.

## Licenses

| Part | License |
| --- | --- |
| Core (`packages/core`), UI kit (`packages/ui`), Projects (`apps/projects`), examples | [Apache License 2.0](https://github.com/marketgrowth/openact/blob/main/LICENSE) |
| Docs, Advisory and eSign (private repository) | OpenAct Director License 1.0, in each app's `LICENSE` file |

The OpenAct Director License lets a licensee read and change the code of paid apps, and run them for development and testing. Production use needs a Director or Producer plan. Versions of Docs released before November 10, 2026 stay under the Apache License 2.0.

## For app builders

An app asks for a plan with `"plan"` in the `openact` field of its `package.json`:

```json
{
  "openact": { "id": "docs", "name": "Docs", "plan": "director", "released": "2026-11-18" }
}
```

Use `"director"` or `"producer"`. The paid apps live in the private `marketgrowth/openact-director` repository and use only the public SDK, like any other app. Set `"released"` to the release day each time you release a new version. Without it, the app gets no [perpetual fallback](#perpetual-fallback-on-your-own-deploy). Only official MarketGrowth apps use it today. Apps from other publishers are free. The core checks the plan everywhere it checks that an app is on, so a paid app needs no plan code of its own. See [Build an app](apps.md).
