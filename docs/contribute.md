# Contributions

The Contribute page is a public landing page at [openact.ing/contribute](https://openact.ing/contribute). People use it to help build OpenAct. The main menu of the openact.ing home page links to it.

The page also lists the nonprofits, and the projects that support nonprofits, that OpenAct helps build software for. Edit the list in the "Who we build for" section of `www/src/pages/contribute.astro`.

The site owner (the super admin) finds Contribute in **Company settings > Contribute**. Other people do not see it. The section links to the page and opens it in a new browser tab. The old address, `/contribute` on a deploy, sends people to the new page.

The page and its payment routes run on the website Worker (`openact-site`), not on an OpenAct deploy. A deploy needs no contribution settings.

People can pay in two ways:

- **By card**, through [Stripe Checkout](https://docs.stripe.com/payments/checkout). They can give once or each month.
- **In USDC**, through [x402](https://www.x402.org) version 2. A person signs one payment in a browser wallet. An AI agent can pay the same endpoint with any x402 client.

Each way shows on the page only when it is set up. With no settings, the page says that contributions are not set up yet.

## Where the money goes

Payments go to the account that owns `STRIPE_SECRET_KEY` and to the wallet in `X402_PAY_TO`.

## Settings

Set each value as a secret on the website Worker, `openact-site`, so that a deploy does not replace it:

```sh
npx wrangler secret put STRIPE_SECRET_KEY --config www/wrangler.jsonc
```

You can also add them in the Cloudflare dashboard: Workers and Pages, then `openact-site`, then Settings, then Variables and Secrets.

| Setting | What it does |
| --- | --- |
| `STRIPE_SECRET_KEY` | Turns on card payments. Use a [restricted key](https://docs.stripe.com/keys#limit-access) with write access to Checkout Sessions only. |
| `STRIPE_ACCOUNT` | Optional. A connected account id (`acct_...`). Use it when your platform account creates the checkout for a connected account. |
| `STRIPE_PORTAL_URL` | Optional. The [customer portal](https://docs.stripe.com/customer-management/activate-no-code-customer-portal) login link, such as `https://billing.stripe.com/p/login/...`. The page then shows "Manage your monthly contribution" under the card button. |
| `X402_PAY_TO` | Turns on USDC payments. The receiving wallet address on Base. |
| `X402_NETWORK` | `eip155:8453` for Base, or `eip155:84532` for Base Sepolia. Default: Base Sepolia, a test network. |
| `X402_FACILITATOR_URL` | The x402 facilitator that checks and settles each payment. Default: `https://x402.org/facilitator`, which works only on test networks. |
| `X402_FACILITATOR_TOKEN` | Optional. A bearer token, for a facilitator that needs one. |

The facilitator pays the network fee. The person pays only the amount.

## Set up checklist

Do these steps in order. Test each payment method before you switch it to live.

### 1. Deploy

Workers Builds builds and deploys `www/` to `openact-site` from the `demo` branch. Read `DEMO.md` and `www/README.md`. To deploy it by hand, run `npm install` and then `npm run deploy` in `www/`.

Open `https://openact.ing/contribute`. With no settings, the page says that contributions are not set up yet.

Add `--config www/wrangler.jsonc` to each `wrangler secret put` command below.

### 2. Stripe

1. Use the Stripe account of the business that receives the money. Finish its activation: business details and a bank account.
2. In test mode, open Developers, then API keys. Make a restricted key with **Checkout Sessions: Write** only.
3. Set it: `npx wrangler secret put STRIPE_SECRET_KEY --config www/wrangler.jsonc`.
4. On the Contribute page, pay once and pay monthly with the test card `4242 4242 4242 4242`. If Stripe refuses a checkout, its error names the missing permission. Add only that permission.
5. Make the same restricted key in live mode. Set it as `STRIPE_SECRET_KEY` again.
6. In Settings, then Customer emails, turn on receipts for successful payments.
7. In Settings, then Public details, set the statement descriptor, such as `OPENACT`.
8. In Settings, then Billing, then Customer portal, turn on the portal. Let customers cancel subscriptions and update payment methods. Copy the login link.
9. Set it: `npx wrangler secret put STRIPE_PORTAL_URL --config www/wrangler.jsonc`. The page then links to it, so monthly supporters can change or stop their payments.

With a test mode key (`sk_test_` or `rk_test_`), the page shows a "Test mode" badge and the test card number. No real money moves. A live key removes both.

### 3. USDC on Base (x402)

1. Get a wallet that you control on Base, such as Coinbase Wallet or another EVM wallet. A payment to a wrong address usually cannot be recovered.
2. Set it: `npx wrangler secret put X402_PAY_TO --config www/wrangler.jsonc`. The address is public. The page shows it.
3. Test on Base Sepolia. This is the default, so set no other value. Get test USDC from the [Circle faucet](https://faucet.circle.com). Give $1 from the Contribute page with a browser wallet. Find the transaction on [Base Sepolia Basescan](https://sepolia.basescan.org).
4. Set `X402_NETWORK` to `eip155:8453` (Base).
5. Set `X402_FACILITATOR_URL` to a facilitator that settles on Base mainnet. The default facilitator works only on test networks.
6. Give $1 again and find the transaction on [Basescan](https://basescan.org).
7. To change USDC to US dollars, send it to an exchange account, such as Coinbase, and withdraw to your bank.

#### Choose a mainnet facilitator

| Facilitator | Works with OpenAct today |
| --- | --- |
| `https://x402.org/facilitator` | Test networks only. |
| Coinbase CDP | Not yet. It needs CDP API keys that sign each request. OpenAct sends only a fixed bearer token. |
| A facilitator with no key, or with a fixed bearer token | Yes. Check its list of supported networks for `eip155:8453` first. |

A facilitator cannot send the money to another wallet, because each signed payment names your wallet. A facilitator can see the payments. If it is down, USDC payments fail, and card payments still work.

### 4. Docs site

To publish docs.openact.app on each merge, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as secrets in the GitHub repository settings. Without them, the Docs workflow builds the site but skips the deploy.

### 5. Records

Card and USDC payments are income to the business that owns the keys. They are not donations. Ask your accountant how to record them.

## Limits

- The smallest contribution is $1. The largest is $10,000.
- Amounts are in US dollars, with up to 2 decimal places. USDC uses 6 decimals, so $1 is `1000000` base units.

## For AI agents

The x402 endpoint is `https://openact.ing/api/contribute/x402?amount=<dollars>`. It takes GET or POST.

1. Call it with no payment. It answers `402 Payment Required`. The `PAYMENT-REQUIRED` header holds the terms as base64 JSON. The body holds the same JSON.
2. Sign an EIP-3009 `TransferWithAuthorization` for the terms in `accepts[0]`.
3. Call it again with the signed payment in the `PAYMENT-SIGNATURE` header.
4. A good payment gets `200`. The `PAYMENT-RESPONSE` header and the body hold the transaction hash.

```sh
curl -i "https://openact.ing/api/contribute/x402?amount=5"
```

The server accepts only the terms it offers. A payment with another amount, network, asset or wallet gets `402` again, with the reason in `error`.

## The API

All routes are on `https://openact.ing`.

| Route | What it does |
| --- | --- |
| `GET /api/contribute` | The payment options that are set up. |
| `POST /api/contribute/checkout` | Starts Stripe Checkout. Body: `{ "amount": "25", "frequency": "once" }` or `"monthly"`. Returns `{ "url" }`. Only the Contribute page can call it. |
| `GET` or `POST /api/contribute/x402?amount=5` | The x402 resource. |

The code is in `www/worker/contribute.ts` (the Worker routes), `www/src/pages/contribute.astro` and `www/public/contribute.js` (the page) and `src/shared/contribute.ts` (the shared rules).

## Move from a deploy to openact.ing

Before November 2026, the page and its routes ran on each deploy at `/contribute` and `/api/apps/site/contribute`. To move:

1. Set the same secrets on `openact-site`.
2. Delete them from the old deploy's Worker, such as `openact-demo`. That Worker does not read them now.
3. Tell AI agents that used the old x402 endpoint to use `https://openact.ing/api/contribute/x402`.
