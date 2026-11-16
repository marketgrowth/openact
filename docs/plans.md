---
title: Plans
description: OpenAct is free and open source. OpenAct Director and OpenAct Producer add paid apps, with one annual price per company.
---

# Plans

The OpenAct core, the UI and the Projects app are free and open source. Paid apps come with a paid plan. Docs and Advisory are the paid apps today.

| Plan | For | What you get |
| --- | --- | --- |
| **Free** | Everyone | The core, the UI and the [Projects](getting-started.md) app, under the Apache License 2.0 |
| **Director** | Startups to midmarket companies | Everything in Free, plus [Docs](docs-app.md) and [Advisory](advisory-app.md). More paid apps will join Director. |
| **Producer** | Enterprise companies | Everything in Director |

Each paid plan has one annual price per company. The price does not change with the number of people. Choose the plan that fits the size of your company.

## Get a plan

There are three ways to get a plan. A super admin can also [give one person a paid app](#give-one-person-a-paid-app).

- **On a site that sells plans:** a company owner opens the **Plan** page and chooses a plan. Stripe takes the payment. The plan starts as soon as Stripe confirms it.
- **The site plan:** when the owner of the site pays for a plan, every company on the site gets it. Read [The site plan](#the-site-plan).
- **On your own deploy:** MarketGrowth gives you a license key. Put it in the `OPENACT_LICENSE` secret. Every company on the deploy gets the plan in the key.

When a company has more than one, it gets the highest plan.

### The site plan

The super owner is the owner of the brand that runs the site. In OpenAct, that is a super admin (an email in `SUPER_ADMIN_EMAILS`) who is an **owner** of a company.

When the super owner pays for a plan in their own company, that plan becomes the site plan. Every company on the site gets its paid apps.

- Other companies see "The owner of this site pays for this plan" on the Plan page. They cannot buy a plan that the site plan already covers.
- The super owner's company sees that its plan unlocks paid apps for every company.
- Each company still turns apps on or off in **Company settings > Apps**.
- Only a company that a super admin owns can give the site plan. A plan that another company pays for covers only that company.
- When the site plan stops, the paid apps lock in every company that has no plan of its own. Their data stays.

The site plan follows the same rules as any subscription: past_due keeps it, and it works 7 days after the paid year ends.

### The Plan page

Open the company menu at the top of the app rail, then choose **Plan**. Company owners and admins also find it in **Company settings**, under **Plan**.

The page shows:

- the company's plan, and when it renews or stops
- the plans for sale on this site, with their prices
- the apps in each plan

In the app, the plans are named **Director** and **Producer**, so the names fit any brand that runs OpenAct.

Only a company owner can buy a plan. Choose **Manage billing** to change the card, see invoices, switch between Director and Producer, or cancel. A canceled plan works until the end of the paid year.

## What happens without a plan

An app that needs a plan is **locked** in a company without that plan.

- The Apps page shows the app with a **Director** badge and an **Upgrade** button. The switch is off and cannot be turned on.
- The app leaves the app rail. Its pages say that it is part of a paid plan.
- Its API routes answer with the code `plan_required`.
- For Docs: share links stop working, and live editing closes.

The app's data stays. When the company gets the plan again, the app comes back with all its data.

If a payment fails, the plan keeps working while Stripe tries the card again. After the paid year ends, the plan keeps working for 7 more days, in case a message from Stripe is late.

### Change the plan descriptions

A super admin can change the sentence under each plan name on the Plan page. Use it to describe the plans in the words of your brand, such as "For homes with up to 15 beds."

1. Open the **Plan** page.
2. Choose the pencil button next to the description of **Free plan**, **Director** or **Producer**.
3. Type the new description, then choose **Save**. Use 200 characters or fewer.
4. To show the default text again, choose **Use default**.

Every company on the site sees the same descriptions. The Free plan description shows only to companies on the free plan. The server checks that the person is a super admin on every save (`PATCH /api/site/plans/:planId`).

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

After the last day, the key keeps working for 14 more days, and the Plan page asks for a new key. Then the paid apps lock.

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
| Docs (`apps/docs`) | [OpenAct Director License 1.0](https://github.com/marketgrowth/openact/blob/main/apps/docs/LICENSE) |
| Advisory (`apps/advisory`) | [OpenAct Director License 1.0](https://github.com/marketgrowth/openact/blob/main/apps/advisory/LICENSE) |

The OpenAct Director License lets you read and change the code of paid apps, and run them for development and testing. Production use needs a Director or Producer plan. Versions of Docs released before November 10, 2026 stay under the Apache License 2.0.

## For app builders

An app asks for a plan with `"plan"` in the `openact` field of its `package.json`:

```json
{
  "openact": { "id": "docs", "name": "Docs", "plan": "director" }
}
```

Use `"director"` or `"producer"`. Only official MarketGrowth apps use it today. Apps from other publishers are free. The core checks the plan everywhere it checks that an app is on, so a paid app needs no plan code of its own. See [Build an app](apps.md).
