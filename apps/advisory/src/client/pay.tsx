import { useEffect, useRef, useState } from "react";
import { api, errorText, fmtDateTime, Icon, Link, navigate, Notice, PageBody, SiteHeader, useToast } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent } from "@openact/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@openact/ui/components/table";
import { ADVISORY_HOME } from "../shared/rules";
import type { AdvisoryRequest, AdvisorySettings } from "../shared/types";
import { Empty, KindBadge, Price, RequestBadge } from "./bits";
import { API, useAdvisory, useLoad } from "./state";

interface PayDetail {
  request: AdvisoryRequest;
  role: "client" | "advisor" | "manager";
  payable: boolean;
  settings: AdvisorySettings;
}

/**
 * The payment page. The Pay button asks the server for a Stripe Checkout Session, so the link in the email never expires.
 * After Checkout, Stripe sends the client back here with ?checkout=done, and the page confirms the payment.
 */
export function PayPage({ requestId }: { requestId: string }) {
  const { companyId } = useAdvisory();
  const toast = useToast();
  const { data, error, reload } = useLoad<PayDetail>(companyId ? `${API}/companies/${companyId}/requests/${requestId}` : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const synced = useRef(false);

  // Back from Stripe: confirm the payment now, before the webhook arrives.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (params.get("checkout") !== "done" || !sessionId || synced.current) return;
    synced.current = true;
    setChecking(true);
    void (async () => {
      try {
        const r = await api<{ done: boolean }>(`${API}/checkout-sync`, { body: { sessionId } });
        toast(r.done ? "Payment confirmed. Your project is ready." : "Stripe is still confirming the payment. This page updates when it is done.");
      } catch (e) {
        setErr(errorText(e));
      } finally {
        setChecking(false);
        window.history.replaceState(null, "", window.location.pathname);
        await reload();
      }
    })();
  }, [reload, toast]);

  const pay = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ url?: string; done?: boolean }>(`${API}/companies/${companyId}/requests/${requestId}/checkout`, { method: "POST" });
      if (r.url) window.location.assign(r.url);
      else await reload();
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  };

  const cancel = async () => {
    try {
      await api(`${API}/companies/${companyId}/requests/${requestId}/cancel`, { method: "POST" });
      toast("Canceled.");
      navigate(`${ADVISORY_HOME}/my`);
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const r = data?.request;
  const terms = r?.terms;
  return (
    <>
      <SiteHeader title="Payment" />
      <PageBody>
        {error && <Notice tone="error">{error}</Notice>}
        {err && <Notice tone="error">{err}</Notice>}
        {checking && <Notice tone="info">Checking the payment with Stripe…</Notice>}
        {r && (
          <Card className="max-w-xl gap-4 py-5" data-pay-page={r.status}>
            <CardContent className="grid gap-4 px-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">With {r.advisor.name}</span>
                <RequestBadge status={r.status} />
              </div>
              {terms ? (
                <div className="grid gap-1">
                  <span className="text-lg font-semibold">{terms.name}</span>
                  <span className="flex items-center gap-2">
                    <Price price={terms.price} kind={terms.kind} className="text-2xl" />
                    <KindBadge kind={terms.kind} />
                  </span>
                  {terms.kind === "retainer" && <p className="text-sm text-muted-foreground">Stripe charges this every month until you or the advisor cancels.</p>}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{r.advisor.name} has not set a price yet. You get an email when they accept.</p>
              )}
              {r.message && (
                <div className="grid gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Your message</span>
                  <p className="whitespace-pre-line text-sm">{r.message}</p>
                </div>
              )}
              {r.status === "declined" && r.declineNote && <Notice>Their note: {r.declineNote}</Notice>}

              {r.status === "paid" && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">Paid {r.paidAt ? fmtDateTime(r.paidAt) : ""}.</span>
                  {r.engagement?.projectPath && (
                    <Button asChild size="sm">
                      <Link to={r.engagement.projectPath}>
                        <Icon name="projects" /> Open the project
                      </Link>
                    </Button>
                  )}
                </div>
              )}

              {data.role === "client" && r.status === "accepted" && terms && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={pay} disabled={busy || !data.payable} data-pay-now="">
                    <Icon name="card" /> {busy ? "Opening Stripe…" : "Pay with Stripe"}
                  </Button>
                  <Button variant="outline" onClick={cancel}>
                    Cancel
                  </Button>
                </div>
              )}
              {data.role === "client" && r.status === "accepted" && !data.payable && (
                <Notice>{r.advisor.name} cannot take payments right now. Try again later.</Notice>
              )}
              {data.role !== "client" && r.status === "accepted" && <p className="text-xs text-muted-foreground">The client pays on this page.</p>}
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  );
}

/** The client's own requests and purchases. */
export function MyRequestsPage() {
  const { companyId, settings } = useAdvisory();
  const { data, error } = useLoad<{ requests: AdvisoryRequest[] }>(companyId ? `${API}/companies/${companyId}/my/requests` : null);
  const list = data?.requests ?? [];
  return (
    <>
      <SiteHeader title="My requests" />
      <PageBody>
        {error && <Notice tone="error">{error}</Notice>}
        {data && !list.length && (
          <Empty title="No requests yet">
            Open a {settings.label.toLowerCase()}'s profile, then choose Book a consult or Pay in advance.
          </Empty>
        )}
        {list.length > 0 && (
          <div className="overflow-hidden rounded-lg border">
            <Table data-my-requests="">
              <TableHeader>
                <TableRow>
                  <TableHead>{settings.label}</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Sent</TableHead>
                  <TableHead className="text-right">Next step</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((r) => (
                  <TableRow key={r.id} data-request={r.id}>
                    <TableCell className="font-medium">{r.advisor.name}</TableCell>
                    <TableCell>{r.terms ? <span>{r.terms.name}, <Price price={r.terms.price} kind={r.terms.kind} /></span> : <span className="text-muted-foreground">Consult request</span>}</TableCell>
                    <TableCell>
                      <RequestBadge status={r.status} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{fmtDateTime(r.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {r.status === "accepted" && (
                        <Button asChild size="xs">
                          <Link to={`${ADVISORY_HOME}/pay/${r.id}`}>Pay</Link>
                        </Button>
                      )}
                      {r.status === "paid" && r.engagement?.projectPath && (
                        <Button asChild size="xs" variant="outline">
                          <Link to={r.engagement.projectPath}>Open project</Link>
                        </Button>
                      )}
                      {r.status === "pending" && (
                        <Button asChild size="xs" variant="ghost">
                          <Link to={`${ADVISORY_HOME}/pay/${r.id}`}>View</Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageBody>
    </>
  );
}
