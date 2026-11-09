# Contributions

Every OpenAct deploy has a public page at `/contribute`. People use it to help pay for OpenAct. Most of each contribution is donated to the Lyra Music Foundation. The foundation uses OpenAct to build agentic software that teaches music and theater to young adults around the world.

The Lyra Music Foundation is fiscally sponsored by [The Hack Foundation](https://hackclub.com/). The Hack Foundation is a 501(c)(3) public charity with the EIN 81-2908499.

The Contribute icon (a heart) sits at the bottom of the app rail, on top of the Colophon icon.

People can pay in two ways:

- **By card**, through [Stripe Checkout](https://docs.stripe.com/payments/checkout). They can give once or each month.
- **In USDC**, through [x402](https://www.x402.org) version 2. A person signs one payment in a browser wallet. An AI agent can pay the same endpoint with any x402 client.

Each way shows on the page only when it is set up. With no settings, the page says that contributions are not set up yet.

## Where the money goes

Payments go to the account that owns `STRIPE_SECRET_KEY` and to the wallet in `X402_PAY_TO`. The page says that most of each contribution is donated to the Lyra Music Foundation. Keep that promise: donate most of what comes in.

On a fork, change the page text in `src/client/Contribute.tsx` and `src/shared/contribute.ts` if your money goes somewhere else.

## Settings

Set each value as a secret, so that a deploy does not replace it:

```sh
npx wrangler secret put STRIPE_SECRET_KEY
```

| Setting | What it does |
| --- | --- |
| `STRIPE_SECRET_KEY` | Turns on card payments. Use a [restricted key](https://docs.stripe.com/keys#limit-access) with write access to Checkout Sessions only. |
| `STRIPE_ACCOUNT` | Optional. A connected account id (`acct_...`). Use it when your platform account creates the checkout for a connected account. |
| `X402_PAY_TO` | Turns on USDC payments. The receiving wallet address on Base. |
| `X402_NETWORK` | `eip155:8453` for Base, or `eip155:84532` for Base Sepolia. Default: Base Sepolia, a test network. |
| `X402_FACILITATOR_URL` | The x402 facilitator that checks and settles each payment. Default: `https://x402.org/facilitator`, which works only on test networks. |
| `X402_FACILITATOR_TOKEN` | Optional. A bearer token, for a facilitator that needs one. |

### Go live with USDC

1. Test on Base Sepolia first. Get test USDC from the [Circle faucet](https://faucet.circle.com).
2. Set `X402_NETWORK` to `eip155:8453`.
3. Set `X402_FACILITATOR_URL` to a facilitator that settles on Base mainnet. Check that it accepts a bearer token or no token.
4. Make a test payment of $1 and check it on [Basescan](https://basescan.org).

The facilitator pays the network fee. The person pays only the amount.

## Limits

- The smallest contribution is $1. The largest is $10,000.
- Amounts are in US dollars, with up to 2 decimal places. USDC uses 6 decimals, so $1 is `1000000` base units.

## For AI agents

The x402 endpoint is `/api/apps/site/contribute/x402?amount=<dollars>`. It takes GET or POST.

1. Call it with no payment. It answers `402 Payment Required`. The `PAYMENT-REQUIRED` header holds the terms as base64 JSON. The body holds the same JSON.
2. Sign an EIP-3009 `TransferWithAuthorization` for the terms in `accepts[0]`.
3. Call it again with the signed payment in the `PAYMENT-SIGNATURE` header.
4. A good payment gets `200`. The `PAYMENT-RESPONSE` header and the body hold the transaction hash.

```sh
curl -i "https://your-openact.example.com/api/apps/site/contribute/x402?amount=5"
```

The server accepts only the terms it offers. A payment with another amount, network, asset or wallet gets `402` again, with the reason in `error`.

## The API

| Route | What it does |
| --- | --- |
| `GET /api/apps/site/contribute` | The payment options that are set up. |
| `POST /api/apps/site/contribute/checkout` | Starts Stripe Checkout. Body: `{ "amount": "25", "frequency": "once" }` or `"monthly"`. Returns `{ "url" }`. |
| `GET` or `POST /api/apps/site/contribute/x402?amount=5` | The x402 resource. |

The code is in `src/server/site.ts` (the Worker), `src/client/Contribute.tsx` (the page) and `src/shared/contribute.ts` (the shared rules).
