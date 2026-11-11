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

There are two ways to get a plan.

- **On a site that sells plans:** a company owner opens the **Plan** page and chooses a plan. Stripe takes the payment. The plan starts as soon as Stripe confirms it.
- **On your own deploy:** MarketGrowth gives you a license key. Put it in the `OPENACT_LICENSE` secret. Every company on the deploy gets the plan in the key.

When a company has both, it gets the higher plan.

### The Plan page

Open the company menu at the top of the app rail, then choose **Plan**. Company owners and admins also find it in **Company settings**, on the **Plan** tab.

The page shows:

- the company's plan, and when it renews or stops
- the plans for sale on this site, with their prices
- the apps in each plan

Only a company owner can buy a plan. Choose **Manage billing** to change the card, see invoices, switch between Director and Producer, or cancel. A canceled plan works until the end of the paid year.

## What happens without a plan

An app that needs a plan is **locked** in a company without that plan.

- The Apps page shows the app with a **Director** badge and an **Upgrade** button. The switch is off and cannot be turned on.
- The app leaves the app rail. Its pages say that it is part of OpenAct Director.
- Its API routes answer with the code `plan_required`.
- For Docs: share links stop working, and live editing closes.

The app's data stays. When the company gets the plan again, the app comes back with all its data.

If a payment fails, the plan keeps working while Stripe tries the card again. After the paid year ends, the plan keeps working for 7 more days, in case a message from Stripe is late.

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

A license key is a signed text that starts with `oa1.`. It names the licensee, the plan, the last day and, if you want, the host names where it works. The core checks the signature with the public keys in `packages/core/src/server/license-keys.ts`. It needs no network.

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
