import { useCallback, useEffect, useRef, useState } from "react";
import { PLANS, formatPrice, type CompanyPlan, type PaidPlan, type PlanOffer } from "@openact/core/shared";
import { api, errorText } from "../api";
import { navigate } from "../router";
import { Icon, Notice, useToast } from "../ui";
import { useWorkspace } from "../workspace";
import { PageBody, SiteHeader } from "./SiteHeader";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { cn } from "@openact/ui/lib/utils";

/*
 * Plans: Free (open source), Director and Producer.
 * The Plan page at /plan shows the company's plan, the plans for sale on this deploy and the apps that need a plan.
 * Company owners buy a plan with Stripe Checkout and manage it in the Stripe billing portal.
 */

/** The page for plans. The shell shows it at /plan. */
export const PLAN_PATH = "/plan";

/** A badge for an app that needs a plan, such as "Director", in the stage gold of the OpenAct brand. */
export function PlanBadge({ plan, className }: { plan: PaidPlan; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 border-brand-gold/40 bg-brand-gold/10 text-brand-gold", className)}
      title={`Part of ${PLANS[plan].name}`}
      data-plan-badge={plan}
    >
      <Icon name="star" size={12} /> {PLANS[plan].short}
    </Badge>
  );
}

const dateText = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";

/** The Plan page. */
export function PlanPage() {
  const ws = useWorkspace();
  const current = ws.current;
  return (
    <>
      <SiteHeader title={current?.name ?? "Plan"} />
      <PageBody>
        <div className="grid gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">Plan</h2>
          <p className="text-sm text-muted-foreground">
            OpenAct is free and open source. Director and Producer add paid apps, with one annual price per company.
          </p>
        </div>
        {current ? <PlanPanel companyId={current.id} /> : <p className="text-sm text-muted-foreground">Make a company to choose a plan.</p>}
      </PageBody>
    </>
  );
}

/** The plan of one company, with the offers. The Plan page and the Plan tab in Company settings show it. */
export function PlanPanel({ companyId }: { companyId: string }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [info, setInfo] = useState<CompanyPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const synced = useRef(false);
  const wsRef = useRef(ws);
  wsRef.current = ws;

  const load = useCallback(async () => {
    try {
      setInfo(await api<CompanyPlan>(`/api/companies/${companyId}/plan`));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [companyId]);

  // After Stripe Checkout, save the subscription at once, then clean the address.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (params.get("checkout") !== "done" || !sessionId || synced.current) {
      load();
      return;
    }
    synced.current = true;
    (async () => {
      try {
        const r = await api<{ companyId: string; done: boolean }>("/api/billing/checkout-sync", { body: { sessionId } });
        const w = wsRef.current;
        if (r.companyId !== w.current?.id) await w.switchTo(r.companyId);
        setNotice(r.done ? "Thank you. Your plan is active." : "Thank you. Stripe is still confirming your payment. Reload this page in a minute.");
        await w.reloadAccess();
      } catch (e) {
        setNotice(errorText(e));
      }
      navigate(PLAN_PATH, true);
      load();
    })();
  }, [load]);

  const go = async (key: string, path: string, body?: unknown) => {
    setBusy(key);
    try {
      const { url } = await api<{ url: string }>(path, { method: "POST", body: body ?? {} });
      window.location.assign(url);
    } catch (e) {
      toast(errorText(e));
      setBusy(null);
    }
  };

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!info) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const sub = info.subscription;
  const paying = !!sub?.active;

  return (
    <div className="grid gap-5" data-plan-panel="" data-plan={info.plan}>
      {notice && <Notice tone="info">{notice}</Notice>}

      <section className="grid gap-2 rounded-xl border bg-card p-4" aria-labelledby="plan-current">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="plan-current" className="font-semibold">
            {info.plan === "free" ? "Free plan" : PLANS[info.plan].name}
          </h3>
          {info.plan !== "free" && <PlanBadge plan={info.plan} />}
        </div>
        <p className="text-sm text-muted-foreground">
          {info.source === "license" && info.license
            ? `This site has a license for ${info.license.licensee}, until ${dateText(info.license.expiresAt)}.`
            : info.source === "subscription" && sub
              ? sub.cancelAtPeriodEnd
                ? `Your plan stops on ${dateText(sub.periodEnd)}. Paid apps lock then, and their data stays.`
                : `Your plan renews on ${dateText(sub.periodEnd)}.`
              : PLANS.free.audience}
        </p>
        {info.license?.inGrace && (
          <Notice tone="warn">The license key expired. Paid apps stop soon. Ask the person who runs this site to put in a new key.</Notice>
        )}
        {sub && sub.status === "past_due" && <Notice tone="error">Stripe could not take the last payment. Update the card with Manage billing.</Notice>}
        {info.canManage && sub?.status && (
          <div>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => go("portal", `/api/companies/${companyId}/plan/portal`)}>
              <Icon name="card" /> {busy === "portal" ? "Opening…" : "Manage billing"}
            </Button>
          </div>
        )}
      </section>

      <ul className="grid gap-3 sm:grid-cols-2">
        {info.offers.map((o) => (
          <OfferCard
            key={o.plan}
            offer={o}
            current={info.plan === o.plan}
            included={info.plan === "producer" && o.plan === "director"}
            apps={info.apps.filter((a) => a.plan === "director" || a.plan === o.plan).map((a) => a.name)}
            canBuy={info.canManage && !paying && info.source !== "license"}
            busy={busy === o.plan}
            disabled={!!busy}
            contactUrl={info.contactUrl}
            onBuy={() => go(o.plan, `/api/companies/${companyId}/plan/checkout`, { plan: o.plan })}
          />
        ))}
      </ul>

      {!info.billing && info.plan === "free" && (
        <p className="text-sm text-muted-foreground">
          Plans are not for sale on this site. If you run it yourself, a license key from MarketGrowth unlocks the paid apps.{" "}
          <a className="underline underline-offset-4" href="https://docs.openact.app/plans" target="_blank" rel="noreferrer">
            Read about plans
          </a>
          .
        </p>
      )}
      {info.billing && !info.canManage && info.plan === "free" && (
        <p className="text-sm text-muted-foreground">Only a company owner can choose a plan. Ask an owner of this company.</p>
      )}
    </div>
  );
}

function OfferCard(p: {
  offer: PlanOffer;
  current: boolean;
  included: boolean;
  apps: string[];
  canBuy: boolean;
  busy: boolean;
  disabled: boolean;
  contactUrl: string | null;
  onBuy: () => void;
}) {
  const { offer } = p;
  return (
    <li className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", p.current && "border-brand-gold/60")} data-plan-offer={offer.plan}>
      <div className="flex items-center gap-2">
        <span className="font-semibold">{offer.name}</span>
        <PlanBadge plan={offer.plan} className="ml-auto" />
      </div>
      <p className="text-sm text-muted-foreground">{offer.audience}</p>
      {p.apps.length > 0 && (
        <p className="text-sm">
          <span className="text-muted-foreground">Apps: </span>
          {p.apps.join(", ")}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{offer.price ? formatPrice(offer.price) : ""}</span>
        {p.current ? (
          <Badge variant="secondary">Your plan</Badge>
        ) : p.included ? (
          <Badge variant="secondary">Included</Badge>
        ) : p.canBuy && offer.buyable ? (
          <Button size="sm" disabled={p.disabled} onClick={p.onBuy}>
            {p.busy ? "Opening Stripe…" : `Choose ${PLANS[offer.plan].short}`}
          </Button>
        ) : !offer.buyable && p.contactUrl ? (
          <Button asChild size="sm" variant="outline">
            <a href={p.contactUrl} target="_blank" rel="noreferrer">
              Talk to us
            </a>
          </Button>
        ) : null}
      </div>
    </li>
  );
}
