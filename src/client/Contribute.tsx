import { Icon, Link, Logo, ThemeSwitch, api, errorText, useShell } from "@openact/ui";
import { Alert, AlertDescription, AlertTitle } from "@openact/ui/components/alert";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@openact/ui/components/card";
import { Input } from "@openact/ui/components/input";
import { Label } from "@openact/ui/components/label";
import { ToggleGroup, ToggleGroupItem } from "@openact/ui/components/toggle-group";
import { useEffect, useState } from "react";
import {
  MAX_USD,
  MIN_USD,
  PRESETS_USD,
  X402_NETWORKS,
  encodeHeader,
  FISCAL_SPONSOR,
  formatUsd,
  parseUsd,
  transferTypedData,
  type ContributeOptions,
  type Frequency,
  type PaymentRequired,
  type X402Network
} from "../shared/contribute";

/*
 * Contribute: a public page at /contribute. People pay by card (Stripe Checkout)
 * or in USDC (x402 v2). Most of each contribution is donated to the Lyra Music Foundation.
 * The server side is in src/server/site.ts.
 */

const BASE = "/api/apps/site/contribute";

interface Wallet {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Wallet;
  }
}

type Receipt = { message: string; receipt: string; transaction: string };

function randomNonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

async function switchChain(wallet: Wallet, net: X402Network): Promise<void> {
  const chainId = `0x${net.chainId.toString(16)}`;
  try {
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (e) {
    // 4902: the wallet does not know the network yet.
    if ((e as { code?: number })?.code !== 4902) throw e;
    await wallet.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId, chainName: net.name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [net.rpcUrl], blockExplorerUrls: [net.explorer] }]
    });
  }
}

/** Pays the x402 resource with the person's browser wallet: read the terms, sign an EIP-3009 authorization, send it. */
async function payWithWallet(endpoint: string, dollars: string, net: X402Network): Promise<Receipt> {
  const wallet = window.ethereum;
  if (!wallet) throw new Error("No wallet found in this browser. Install a wallet such as Coinbase Wallet or MetaMask, or pay by card.");
  const accounts = (await wallet.request({ method: "eth_requestAccounts" })) as string[];
  const from = accounts?.[0];
  if (!from) throw new Error("Connect a wallet account to continue.");
  await switchChain(wallet, net);

  const url = `${endpoint}?amount=${encodeURIComponent(dollars)}`;
  const first = await fetch(url, { method: "POST", credentials: "same-origin" });
  const terms = (await first.json().catch(() => null)) as (PaymentRequired & { error?: string }) | null;
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
  const signature = (await wallet.request({
    method: "eth_signTypedData_v4",
    params: [from, JSON.stringify(transferTypedData(net, authorization))]
  })) as string;

  const paid = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "PAYMENT-SIGNATURE": encodeHeader({ x402Version: 2, resource: terms.resource, accepted: req, payload: { signature, authorization } }) }
  });
  const result = (await paid.json().catch(() => null)) as (Receipt & { error?: string }) | null;
  if (!paid.ok || !result?.transaction) throw new Error(result?.error || "The payment did not go through. Your wallet was not charged.");
  return result;
}

function walletError(e: unknown): string {
  const code = (e as { code?: number })?.code;
  if (code === 4001) return "You closed the wallet request. Nothing was paid.";
  return errorText(e);
}

export function Contribute() {
  const { config, me } = useShell();
  const [options, setOptions] = useState<ContributeOptions | null>(null);
  const [loadError, setLoadError] = useState("");
  const [preset, setPreset] = useState<string>("25");
  const [other, setOther] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("once");
  const [busy, setBusy] = useState<"" | "card" | "crypto">("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const thanksCard = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("thanks") === "card";

  useEffect(() => {
    api<ContributeOptions>(BASE)
      .then(setOptions)
      .catch((e) => setLoadError(errorText(e)));
  }, []);

  const dollars = preset === "other" ? other.trim().replace(/^\$/, "") : preset;
  const parsed = parseUsd(dollars);
  const amountError = preset === "other" && other.trim() && "error" in parsed ? parsed.error : "";
  const cents = "cents" in parsed ? parsed.cents : 0;
  const net = options?.crypto ? X402_NETWORKS[options.crypto.network] : undefined;

  async function payByCard() {
    setError("");
    setBusy("card");
    try {
      const { url } = await api<{ url: string }>(`${BASE}/checkout`, { body: { amount: dollars, frequency } });
      window.location.assign(url);
    } catch (e) {
      setError(errorText(e));
      setBusy("");
    }
  }

  async function payWithUsdc() {
    if (!options?.crypto || !net) return;
    setError("");
    setBusy("crypto");
    try {
      setReceipt(await payWithWallet(options.crypto.endpoint, dollars, net));
    } catch (e) {
      setError(walletError(e));
    } finally {
      setBusy("");
    }
  }

  const none = options && !options.card && !options.crypto;

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-2 px-4 lg:px-6">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold" aria-label={`${config.appName} home`}>
            <Logo />
            <span>{config.appName}</span>
          </Link>
          <span className="flex-1" />
          <ThemeSwitch />
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 lg:px-6" data-contribute="">
        <div className="grid gap-2">
          <p className="text-xs font-medium tracking-wide text-brand-gold uppercase">Contribute</p>
          <h1 className="text-3xl font-semibold tracking-tight text-balance">Help build OpenAct</h1>
          <p className="max-w-2xl text-muted-foreground">
            OpenAct is free and open source. Your contribution helps us keep building it. Most of your contribution is donated to the Lyra Music Foundation.
          </p>
        </div>

        <section className="grid gap-3 border-t pt-6 md:grid-cols-[13rem_1fr] md:gap-8" aria-labelledby="contribute-why">
          <h2 id="contribute-why" className="text-lg font-semibold tracking-tight">
            Where it goes
          </h2>
          <div className="grid max-w-2xl gap-2 text-sm text-muted-foreground">
            <p>The Lyra Music Foundation uses OpenAct to build agentic software.</p>
            <p>The software teaches music and theater to young adults around the world.</p>
            <p>When you help build OpenAct, you also help the foundation reach more students.</p>
            <p data-contribute-sponsor="">
              The Lyra Music Foundation is fiscally sponsored by{" "}
              <a href={FISCAL_SPONSOR.url} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-4 hover:text-foreground">
                {FISCAL_SPONSOR.name}
              </a>
              . {FISCAL_SPONSOR.name} is a 501(c)(3) public charity with the EIN {FISCAL_SPONSOR.ein}.
            </p>
          </div>
        </section>

        {thanksCard && (
          <Alert data-contribute-thanks="">
            <Icon name="heart" />
            <AlertTitle>Thank you for your contribution</AlertTitle>
            <AlertDescription>Your card payment went through Stripe. Most of your contribution is donated to the Lyra Music Foundation.</AlertDescription>
          </Alert>
        )}

        {receipt && (
          <Alert data-contribute-thanks="">
            <Icon name="heart" />
            <AlertTitle>Thank you</AlertTitle>
            <AlertDescription>
              <p>{receipt.message}</p>
              <a href={receipt.receipt} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                See the transaction
              </a>
            </AlertDescription>
          </Alert>
        )}

        {loadError && (
          <Alert variant="destructive">
            <AlertTitle>The page cannot load the payment options</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {none && (
          <Alert>
            <AlertTitle>Contributions are not set up on this site yet</AlertTitle>
            <AlertDescription>The site owner adds a Stripe key or a USDC wallet to turn them on. The OpenAct docs explain how.</AlertDescription>
          </Alert>
        )}

        {options && !none && (
          <section className="grid gap-3 border-t pt-6 md:grid-cols-[13rem_1fr] md:gap-8" aria-labelledby="contribute-amount">
            <div className="grid content-start gap-1">
              <h2 id="contribute-amount" className="text-lg font-semibold tracking-tight">
                Your contribution
              </h2>
              <p className="text-sm text-muted-foreground">
                From {formatUsd(MIN_USD * 100)} to {formatUsd(MAX_USD * 100)}, in US dollars.
              </p>
            </div>

            <div className="grid min-w-0 gap-6">
              <div className="grid gap-3">
                <Label id="contribute-amount-label">Amount</Label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={preset}
                  onValueChange={(v) => v && setPreset(v)}
                  aria-labelledby="contribute-amount-label"
                  className="flex-wrap"
                >
                  {PRESETS_USD.map((p) => (
                    <ToggleGroupItem key={p} value={String(p)} className="min-w-16 tabular">
                      ${p}
                    </ToggleGroupItem>
                  ))}
                  <ToggleGroupItem value="other" className="min-w-16">
                    Other
                  </ToggleGroupItem>
                </ToggleGroup>
                {preset === "other" && (
                  <div className="grid max-w-56 gap-1.5">
                    <Label htmlFor="contribute-other">Other amount in US dollars</Label>
                    <Input
                      id="contribute-other"
                      inputMode="decimal"
                      placeholder="40"
                      value={other}
                      onChange={(e) => setOther(e.target.value)}
                      aria-invalid={!!amountError}
                      autoFocus
                    />
                    {amountError && <p className="text-sm text-destructive">{amountError}</p>}
                  </div>
                )}
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertTitle>The payment did not start</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                {options.card && (
                  <Card data-contribute-card="">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Icon name="card" />
                        Pay by card
                      </CardTitle>
                      <CardDescription>Stripe takes your card details. OpenAct never sees them.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-2">
                      <Label id="contribute-frequency-label">How often</Label>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        value={frequency}
                        onValueChange={(v) => v && setFrequency(v as Frequency)}
                        aria-labelledby="contribute-frequency-label"
                      >
                        <ToggleGroupItem value="once">Once</ToggleGroupItem>
                        <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
                      </ToggleGroup>
                      {frequency === "monthly" && <p className="text-sm text-muted-foreground">Stripe charges your card on the same day each month.</p>}
                    </CardContent>
                    <CardFooter>
                      <Button onClick={payByCard} disabled={!cents || !!busy} className="w-full" data-contribute-pay="card">
                        {busy === "card" ? "Opening Stripe…" : cents ? `Give ${formatUsd(cents)}${frequency === "monthly" ? " each month" : ""}` : "Enter an amount"}
                      </Button>
                    </CardFooter>
                  </Card>
                )}

                {options.crypto && net && (
                  <Card data-contribute-crypto="">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Icon name="wallet" />
                        Pay with USDC
                        {options.crypto.testnet && <Badge variant="outline">Test network</Badge>}
                      </CardTitle>
                      <CardDescription>
                        Sign one payment in your wallet on {options.crypto.networkName}. The payment uses the x402 protocol. You pay no network fee.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-1 text-sm text-muted-foreground">
                      <p>The receiving wallet:</p>
                      <code className="font-mono text-xs break-all text-foreground">{options.crypto.payTo}</code>
                    </CardContent>
                    <CardFooter>
                      <Button onClick={payWithUsdc} disabled={!cents || !!busy} variant="outline" className="w-full" data-contribute-pay="crypto">
                        {busy === "crypto" ? "Waiting for your wallet…" : cents ? `Give ${formatUsd(cents)} in USDC` : "Enter an amount"}
                      </Button>
                    </CardFooter>
                  </Card>
                )}
              </div>
            </div>
          </section>
        )}

        {options?.crypto && (
          <section className="grid gap-3 border-t pt-6 md:grid-cols-[13rem_1fr] md:gap-8" aria-labelledby="contribute-agents">
            <div className="grid content-start gap-1">
              <h2 id="contribute-agents" className="text-lg font-semibold tracking-tight">
                For AI agents
              </h2>
              <p className="text-sm text-muted-foreground">Any x402 v2 client can contribute.</p>
            </div>
            <div className="grid min-w-0 gap-3 text-sm text-muted-foreground">
              <p>Call the endpoint with an amount in US dollars. It answers 402 with the payment terms in the PAYMENT-REQUIRED header.</p>
              <p>Send the signed payment in the PAYMENT-SIGNATURE header. A good payment gets 200 and a PAYMENT-RESPONSE header with the transaction.</p>
              <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs text-foreground">
                <code>{`curl -i "${options.crypto.endpoint}?amount=5"`}</code>
              </pre>
            </div>
          </section>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-6">
          <Button asChild variant="outline">
            <Link to="/">{me ? "Back to your projects" : "Sign in"}</Link>
          </Button>
          <Button asChild variant="ghost">
            <a href="https://github.com/marketgrowth/openact" target="_blank" rel="noreferrer">
              <Icon name="external" />
              OpenAct on GitHub
            </a>
          </Button>
        </div>
      </main>
    </div>
  );
}
