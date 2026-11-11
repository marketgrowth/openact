---
title: Advisory
description: Run a marketplace of approved advisors. Members book consults or pay in advance through Stripe Connect, and the company keeps a fee. Part of OpenAct Director.
---

# Advisory

Advisory lets a company run a marketplace of approved advisors. Members can hire an advisor. Members can also apply to become an advisor. Clients pay through Stripe Connect, and the company keeps a fee on each payment. A paid engagement opens a project in the Projects app.

::: tip Part of OpenAct Director
Advisory is a paid app. It needs a [Director or Producer plan](plans.md). Without a plan, Advisory is locked: the Apps page shows it with a **Director** badge and an **Upgrade** button, and your data stays saved.
:::

Advisory comes with OpenAct, next to Projects and Docs. It has its own icon in the app rail. It needs the Projects app.

## Examples

- **GTM Matters** runs Advisory with the label "Consultant". Paid members hire GTM consultants. Members can also apply to sell their own consulting.
- **Orbytt** runs Advisory with the label "Coach". VA coaches and mentors sell coaching sessions and mentorship programs.

The code says "advisor" and "offer". Each company sets its own label in Company settings.

## Who does what

| Role | What they do | Permission |
| --- | --- | --- |
| Member | Sees the advisors, books a consult, pays for an offer | Hire advisors (`advisory.browse`) |
| Advisor | Writes a profile and offers, connects Stripe, answers requests | Sell as an advisor (`advisory.sell`) |
| Manager | Approves advisors, sets each advisor's fee, pauses profiles, sees every engagement | Manage advisors (`advisory.manage`) |
| Client in a project | Works with the advisor in the engagement project only | A member of that project |

By default, owners, admins and members can hire and sell. Owners and admins manage. Change this in Company settings, on the Permissions tab. Guests do not see Advisory.

## Hire an advisor

1. Choose **Advisory** in the app rail. The panel lists each advisor with their name and role.
2. Choose an advisor. Their profile opens with their bio and their offers.
3. Choose one of two buttons:
   - **Book a consult** opens a form. Tell the advisor what you need. The advisor accepts with a price, or declines. You get an email either way.
   - **Pay in advance** shows the advisor's offers. Choose one, then pay with Stripe.
4. On **My requests**, follow each request. Choose **Pay** when a request is accepted.

The payment page makes a new Stripe Checkout each time you choose **Pay with Stripe**, so the link in the email never expires.

## Become an advisor

1. Open **My advisor page** in the Advisory panel. The name follows the company's label, such as **My consultant page**.
2. On **Profile**, write your role and your bio. Add a photo if you want: PNG, JPEG or WebP, up to 2 MB.
3. On **Offers**, add at least one offer. An offer has a name, a description, a price and a type:
   - **One-time**, such as a one-hour strategy session.
   - **Monthly retainer**, charged every month until it is canceled.
4. Choose **Apply**. A manager reviews your profile. You get an email when it is decided.
5. On **Earnings**, choose **Connect Stripe**. Stripe asks for your details and your bank. Clients can pay you when Stripe says your account is ready.

When the company turns on **Approve new profiles without review**, your profile goes live when you apply.

### Answer requests

On the **Requests** tab, choose **Accept** or **Decline**.

- **Accept:** choose one of your offers, or set a custom name, price and type. The client gets an email with a link to the payment page.
- **Decline:** add a note if you want. The client sees it.

The price and the fee are fixed when you accept. A later change to the offer or the fee does not change an accepted request.

### Clients and earnings

- **Clients** lists each paid engagement, with a link to its project.
- **Earnings** shows what clients paid, the brand fees and your share. Choose **Stripe dashboard** to see payouts, every retainer payment and tax forms.

## Manage the marketplace

Owners and admins open **Manage advisors** in the Advisory panel.

- **Applications:** read each profile and its offers. Choose **Approve** and set the fee, or **Decline** with a note.
- **Advisors:** change an advisor's fee, **Pause** a live profile, or **List again**.
- **Engagements:** every paid engagement, with the price and the brand fee.

### Settings

In **Company settings**, on the **Advisory** tab:

| Setting | What it does |
| --- | --- |
| Name for one, Name for many | The label people see, such as Consultant and Consultants |
| Default fee | The fee for new advisors, from 0 to 50 percent |
| Currency | The currency of new offers |
| Approve new profiles without review | Lists profiles when the advisor applies |

## Engagement projects

When Stripe confirms a payment, Advisory opens a project in the Projects app:

- The name is the client's name and the offer, such as "Acme Inc: Growth retainer".
- The project is secret. Only its members see it.
- The advisor owns the project. The client joins it as an editor.

When a retainer ends, the engagement shows **Ended**. The project and its data stay.

## Set up payments

The company's Stripe account is the Stripe Connect platform. Each advisor has a connected Express account. Advisory uses destination charges: the client pays the platform, Stripe sends the advisor's share to their account, and the platform keeps the fee.

1. In Stripe, turn on Connect for the platform account.
2. Set these secrets with `npx wrangler secret put NAME`:

   | Secret | Value |
   | --- | --- |
   | `ADVISORY_STRIPE_SECRET_KEY` | The platform's Stripe secret key |
   | `ADVISORY_STRIPE_WEBHOOK_SECRET` | The signing secret of the webhook in step 3 |

3. In Stripe, add a webhook endpoint at `https://<your site>/api/apps/advisory/stripe-webhook`. Send these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated` and `customer.subscription.deleted`.

Advisory uses its own Stripe key. Plans use `STRIPE_SECRET_KEY`, so the money for plans and the money for advisors never mix.

Without the key, members can still send consult requests, and advisors can still accept them. Nobody can pay until the key is set.

## How it works

- **Data:** five tables, all with a `company_id`: `advisory_settings`, `advisory_advisors`, `advisory_offers`, `advisory_requests` and `advisory_engagements`. Photos are in R2 under `advisory/<company id>/`.
- **Fees** are stored in basis points (1,500 is 15%). A one-time payment sends a fixed `application_fee_amount`. A retainer sends `application_fee_percent`.
- **Payment confirmation** comes from the webhook, and from the payment page when the client comes back from Stripe. Both are safe to run twice. Only the first one opens the project.
- **A person who leaves the company:** their profile is paused, and their open requests close. Paid engagements stay as records.
- **Booking:** a separate Booking app is planned. When it is installed, Advisory will add a **Pick a time** step. Advisory lists Booking in `optionalApps`.

## Open questions

- Can a client hire advisors without a paid membership?
- How do refunds and disputes work? Today, refund in the Stripe dashboard.
- Do clients rate or review advisors?
- Does Booking need more calendars after Google and Microsoft?
