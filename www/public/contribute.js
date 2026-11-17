/*
 * The Contribute page at https://openact.ing/contribute.
 * It reads the payment options from /api/contribute, starts Stripe Checkout, and pays in USDC with a browser wallet (x402 v2).
 * The Worker is landing/src/contribute.ts. The amount rules match parseUsd in src/shared/contribute.ts.
 */

const API = "/api/contribute";
const MIN_USD = 1;
const MAX_USD = 10000;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const show = (el, on) => el && (el.hidden = !on);

/** Dollars to cents, or an error message. Same rules as the Worker. */
function parseUsd(input) {
  const text = String(input ?? "").trim().replace(/^\$/, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return { error: `Enter an amount in US dollars, from $${MIN_USD} to $${MAX_USD.toLocaleString("en-US")}.` };
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (cents < MIN_USD * 100) return { error: `The smallest contribution is $${MIN_USD}.` };
  if (cents > MAX_USD * 100) return { error: `The largest contribution is $${MAX_USD.toLocaleString("en-US")}. Contact us for a larger gift.` };
  return { cents };
}

function formatUsd(cents) {
  return cents % 100 === 0
    ? `$${(cents / 100).toLocaleString("en-US")}`
    : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function readJson(res) {
  return res.json().catch(() => null);
}

/* Base64 of UTF-8 JSON, for the x402 headers. */
function encodeHeader(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function randomNonce() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/* The wallet flow */

async function switchChain(wallet, crypto402) {
  const chainId = `0x${crypto402.chainId.toString(16)}`;
  try {
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (e) {
    // 4902: the wallet does not know the network yet.
    if (e?.code !== 4902) throw e;
    await wallet.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: crypto402.networkName,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [crypto402.rpcUrl],
          blockExplorerUrls: [crypto402.explorer]
        }
      ]
    });
  }
}

/** The EIP-712 typed data for a USDC TransferWithAuthorization (EIP-3009). */
function transferTypedData(c, authorization) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]
    },
    primaryType: "TransferWithAuthorization",
    domain: { name: c.assetName, version: c.assetVersion, chainId: c.chainId, verifyingContract: c.asset },
    message: authorization
  };
}

/** Pays the x402 resource: read the terms, sign an EIP-3009 authorization, send it. */
async function payWithWallet(c, dollars) {
  const wallet = window.ethereum;
  if (!wallet) throw new Error("No wallet found in this browser. Install a wallet such as Coinbase Wallet or MetaMask, or pay by card.");
  const accounts = await wallet.request({ method: "eth_requestAccounts" });
  const from = accounts?.[0];
  if (!from) throw new Error("Connect a wallet account to continue.");
  await switchChain(wallet, c);

  // Same-origin path, so the page CSP (connect-src 'self') allows it.
  const url = `${API}/x402?amount=${encodeURIComponent(dollars)}`;
  const first = await fetch(url, { method: "POST" });
  const terms = await readJson(first);
  if (first.status !== 402 || !terms?.accepts?.[0]) throw new Error(terms?.error || "The server did not send payment terms. Try again.");
  const req = terms.accepts[0];

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from,
    to: req.payTo,
    value: req.amount,
    validAfter: String(now - 600),
    validBefore: String(now + req.maxTimeoutSeconds),
    nonce: randomNonce()
  };
  const signature = await wallet.request({ method: "eth_signTypedData_v4", params: [from, JSON.stringify(transferTypedData(c, authorization))] });

  const paid = await fetch(url, {
    method: "POST",
    headers: { "PAYMENT-SIGNATURE": encodeHeader({ x402Version: 2, resource: terms.resource, accepted: req, payload: { signature, authorization } }) }
  });
  const result = await readJson(paid);
  if (!paid.ok || !result?.transaction) throw new Error(result?.error || "The payment did not go through. Your wallet was not charged.");
  return result;
}

function walletError(e) {
  if (e?.code === 4001) return "You closed the wallet request. Nothing was paid.";
  return e?.message || "Something went wrong. Try again.";
}

/* The page */

const state = { options: null, busy: "" };

function currentDollars() {
  const picked = $('input[name="amount"]:checked')?.value ?? "25";
  return picked === "other" ? $("#other-amount").value.trim().replace(/^\$/, "") : picked;
}

const frequency = () => $('input[name="frequency"]:checked')?.value ?? "once";

function render() {
  const o = state.options;
  if (!o) return;
  const other = $('input[name="amount"]:checked')?.value === "other";
  show($("[data-other]"), other);
  const dollars = currentDollars();
  const parsed = parseUsd(dollars);
  const cents = parsed.cents ?? 0;
  const otherError = other && $("#other-amount").value.trim() && parsed.error ? parsed.error : "";
  $("[data-other-error]").textContent = otherError;
  $("#other-amount").setAttribute("aria-invalid", otherError ? "true" : "false");

  const monthly = frequency() === "monthly";
  show($("[data-monthly-note]"), monthly);

  const card = $('[data-pay="card"]');
  card.disabled = !cents || !!state.busy;
  card.textContent = state.busy === "card" ? "Opening Stripe…" : cents ? `Give ${formatUsd(cents)}${monthly ? " each month" : ""}` : "Enter an amount";

  const usdc = $('[data-pay="crypto"]');
  usdc.disabled = !cents || !!state.busy;
  usdc.textContent = state.busy === "crypto" ? "Waiting for your wallet…" : cents ? `Give ${formatUsd(cents)} in USDC` : "Enter an amount";
}

function payError(message) {
  $("[data-pay-error-text]").textContent = message;
  show($("[data-pay-error]"), !!message);
}

async function payByCard() {
  payError("");
  state.busy = "card";
  render();
  try {
    const res = await fetch(`${API}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: currentDollars(), frequency: frequency() })
    });
    const data = await readJson(res);
    if (!res.ok || !data?.url) throw new Error(data?.error || "Stripe did not start the checkout. Try again.");
    window.location.assign(data.url);
  } catch (e) {
    payError(e?.message || "Stripe did not start the checkout. Try again.");
    state.busy = "";
    render();
  }
}

async function payWithUsdc() {
  const c = state.options?.crypto;
  if (!c) return;
  payError("");
  state.busy = "crypto";
  render();
  try {
    const receipt = await payWithWallet(c, currentDollars());
    $("[data-receipt-message]").textContent = receipt.message;
    $("[data-receipt-link]").href = receipt.receipt;
    show($('[data-thanks="crypto"]'), true);
    $('[data-thanks="crypto"]').scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (e) {
    payError(walletError(e));
  } finally {
    state.busy = "";
    render();
  }
}

function setUp(o) {
  state.options = o;
  show($('[data-state="loading"]'), false);
  if (!o.card && !o.crypto) {
    show($('[data-state="none"]'), true);
    return;
  }
  show($('[data-state="ready"]'), true);

  show($('[data-method="card"]'), o.card);
  show($("[data-test-mode]"), o.cardTestMode);
  show($("[data-test-card]"), o.cardTestMode);
  if (o.manageUrl) {
    $("[data-manage]").href = o.manageUrl;
    show($("[data-manage]"), true);
  }

  const c = o.crypto;
  show($('[data-method="crypto"]'), !!c);
  show($("[data-agents]"), !!c);
  if (c) {
    show($("[data-testnet]"), c.testnet);
    $("[data-crypto-intro]").textContent = `Sign one payment in your wallet on ${c.networkName}. The payment uses the x402 protocol. You pay no network fee.`;
    $("[data-pay-to]").textContent = c.payTo;
    $("[data-agent-curl]").textContent = `curl -i "${c.endpoint}?amount=5"`;
  }

  for (const input of $$('input[name="amount"], input[name="frequency"]')) input.addEventListener("change", render);
  $("#other-amount").addEventListener("input", render);
  $('input[name="amount"][value="other"]').addEventListener("change", () => $("#other-amount").focus());
  $('[data-pay="card"]').addEventListener("click", payByCard);
  $('[data-pay="crypto"]').addEventListener("click", payWithUsdc);
  $("form[data-state]").addEventListener("submit", (e) => e.preventDefault());
  render();
}

if (new URLSearchParams(window.location.search).get("thanks") === "card") show($('[data-thanks="card"]'), true);

fetch(API)
  .then(async (res) => {
    const data = await readJson(res);
    if (!res.ok || !data) throw new Error(data?.error || "Reload the page to try again.");
    setUp(data);
  })
  .catch((e) => {
    show($('[data-state="loading"]'), false);
    $("[data-error-text]").textContent = e?.message || "Reload the page to try again.";
    show($('[data-state="error"]'), true);
  });
