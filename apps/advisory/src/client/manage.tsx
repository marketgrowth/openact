import { useState } from "react";
import { api, errorText, Field, fmtDateTime, Icon, Link, Modal, Notice, PageBody, SiteHeader, useToast } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent } from "@openact/ui/components/card";
import { Input } from "@openact/ui/components/input";
import { Label } from "@openact/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Switch } from "@openact/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@openact/ui/components/tabs";
import { Textarea } from "@openact/ui/components/textarea";
import { ADVISORY_HOME, LIMITS, feeProblem } from "../shared/rules";
import { CURRENCIES, type AdvisorySettings, type ManagePage, type ManagedAdvisor } from "../shared/types";
import { AdvisorBadge, Empty, Portrait } from "./bits";
import { EngagementTable } from "./dashboard";
import { API, useAdvisory, useLoad } from "./state";

/** Managing the marketplace: applications, live advisors and every engagement. */
export function ManagePageView() {
  const { companyId, settings, reload: reloadHome } = useAdvisory();
  const { data, error, reload } = useLoad<ManagePage>(companyId ? `${API}/companies/${companyId}/manage` : null);
  const [dialog, setDialog] = useState<null | { kind: "approve" | "decline" | "fee"; advisor: ManagedAdvisor }>(null);
  const toast = useToast();
  const all = data?.advisors ?? [];
  const pending = all.filter((a) => a.status === "pending");
  const others = all.filter((a) => a.status !== "pending");
  const done = async () => {
    await reload();
    await reloadHome();
  };
  const setStatus = async (a: ManagedAdvisor, status: "approved" | "paused") => {
    try {
      await api(`${API}/companies/${companyId}/manage/advisors/${a.id}`, { method: "PATCH", body: { status } });
      toast(status === "paused" ? `Paused ${a.name}. Members cannot see the profile now.` : `${a.name} is live again.`);
      await done();
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <>
      <SiteHeader title={`Manage ${settings.labelPlural.toLowerCase()}`} />
      <PageBody>
        {error && <Notice tone="error">{error}</Notice>}
        {data && (
          <Tabs defaultValue={pending.length ? "applications" : "advisors"}>
            <TabsList>
              <TabsTrigger value="applications">
                Applications{pending.length ? <Badge className="ml-1 h-5 px-1.5">{pending.length}</Badge> : null}
              </TabsTrigger>
              <TabsTrigger value="advisors">{settings.labelPlural}</TabsTrigger>
              <TabsTrigger value="engagements">Engagements</TabsTrigger>
            </TabsList>

            <TabsContent value="applications" className="grid gap-3 pt-2" data-applications="">
              {!pending.length && <Empty title="No applications waiting">New applications show here. You also get an email.</Empty>}
              {pending.map((a) => (
                <Card key={a.id} className="gap-2 py-4" data-application={a.id}>
                  <CardContent className="grid gap-3 px-4">
                    <div className="flex items-start gap-3">
                      <Portrait id={a.id} name={a.name} url={a.photoUrl} size={48} />
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <span className="font-medium">{a.name}</span>
                        <span className="text-sm text-muted-foreground">
                          {a.headline} · {a.email}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {a.offers} {a.offers === 1 ? "offer" : "offers"} · Stripe {a.stripeReady ? "ready" : "not ready"}
                          {a.submittedAt ? ` · Applied ${fmtDateTime(a.submittedAt)}` : ""}
                        </span>
                      </div>
                    </div>
                    {a.bio && <p className="line-clamp-4 whitespace-pre-line text-sm">{a.bio}</p>}
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="ghost">
                        <Link to={`${ADVISORY_HOME}/p/${a.id}`}>See profile and offers</Link>
                      </Button>
                      <span className="ml-auto flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "decline", advisor: a })}>
                          Decline
                        </Button>
                        <Button size="sm" onClick={() => setDialog({ kind: "approve", advisor: a })} data-approve="">
                          <Icon name="check" /> Approve
                        </Button>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="advisors" className="grid gap-2 pt-2" data-managed-advisors="">
              {!others.length && <Empty title={`No ${settings.labelPlural.toLowerCase()} yet`} />}
              {others.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3" data-managed={a.id}>
                  <Portrait id={a.id} name={a.name} url={a.photoUrl} size={36} />
                  <div className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">{a.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{a.headline}</span>
                  </div>
                  <AdvisorBadge status={a.status} />
                  <span className="text-sm tabular">{a.feePercent}% fee</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{a.engagements} engagements</span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "fee", advisor: a })}>
                      Fee
                    </Button>
                    {a.status === "approved" && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(a, "paused")}>
                        Pause
                      </Button>
                    )}
                    {a.status === "paused" && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(a, "approved")}>
                        List again
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="engagements" className="grid gap-2 pt-2">
              {!data.engagements.length && <Empty title="No engagements yet">Each paid request shows here, with the brand fee.</Empty>}
              {data.engagements.length > 0 && <EngagementTable list={data.engagements} show="all" />}
            </TabsContent>
          </Tabs>
        )}
      </PageBody>
      {dialog && dialog.kind !== "decline" && <FeeDialog mode={dialog.kind} advisor={dialog.advisor} settings={settings} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "decline" && <DeclineApplication advisor={dialog.advisor} onClose={() => setDialog(null)} onDone={done} />}
    </>
  );
}

function FeeDialog({
  mode,
  advisor,
  settings,
  onClose,
  onDone
}: {
  mode: "approve" | "fee";
  advisor: ManagedAdvisor;
  settings: AdvisorySettings;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { companyId } = useAdvisory();
  const toast = useToast();
  const [fee, setFee] = useState(String(mode === "approve" ? settings.defaultFeePercent : advisor.feePercent));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(fee);
    const p = feeProblem(n);
    if (p) return setErr(p);
    setBusy(true);
    try {
      if (mode === "approve") await api(`${API}/companies/${companyId}/manage/advisors/${advisor.id}/approve`, { body: { feePercent: n } });
      else await api(`${API}/companies/${companyId}/manage/advisors/${advisor.id}`, { method: "PATCH", body: { feePercent: n } });
      toast(mode === "approve" ? `${advisor.name} is live.` : "Fee saved.");
      await onDone();
      onClose();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={mode === "approve" ? `Approve ${advisor.name}` : `Fee for ${advisor.name}`}
      description="The brand keeps this percent of each payment. A new fee applies to requests accepted after the change."
      onClose={onClose}
    >
      <form className="grid gap-4" onSubmit={submit} data-fee-form="">
        {err && <Notice tone="error">{err}</Notice>}
        <Field label="Fee (percent)" htmlFor="fee">
          <Input id="fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className="w-32" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {mode === "approve" ? "Approve" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeclineApplication({ advisor, onClose, onDone }: { advisor: ManagedAdvisor; onClose: () => void; onDone: () => Promise<void> }) {
  const { companyId } = useAdvisory();
  const toast = useToast();
  const [note, setNote] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(`${API}/companies/${companyId}/manage/advisors/${advisor.id}/decline`, { body: { note } });
      toast("Declined. The person gets an email.");
      await onDone();
      onClose();
    } catch (e) {
      toast(errorText(e));
    }
  };
  return (
    <Modal title={`Decline ${advisor.name}`} onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="Note (optional)" htmlFor="app-note" help="The person sees this note. They can change the profile and apply again.">
          <Textarea id="app-note" rows={3} maxLength={LIMITS.note} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive">
            Decline
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Company settings, Advisory tab: labels, approval, the default fee and the currency. */
export function AdvisorySettingsTab({ detail, onChanged }: { detail: { id: string; advisory?: unknown }; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const initial = (detail.advisory ?? {}) as Partial<AdvisorySettings> & { payments?: boolean };
  const [label, setLabel] = useState(initial.label ?? "Advisor");
  const [plural, setPlural] = useState(initial.labelPlural ?? "Advisors");
  const [auto, setAuto] = useState(initial.approvalMode === "auto");
  const [fee, setFee] = useState(String(initial.defaultFeePercent ?? 15));
  const [currency, setCurrency] = useState(initial.currency ?? "usd");
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(fee);
    const p = feeProblem(n);
    if (p) return toast(p);
    setBusy(true);
    try {
      await api(`/api/companies/${detail.id}`, {
        method: "PATCH",
        body: { advisory: { label, labelPlural: plural, approvalMode: auto ? "auto" : "required", defaultFeePercent: n, currency } }
      });
      toast("Advisory settings saved.");
      await onChanged();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="grid gap-4" onSubmit={save} data-advisory-settings="">
      {!initial.payments && (
        <Notice>
          Payments are off on this site. The person who runs it sets ADVISORY_STRIPE_SECRET_KEY and ADVISORY_STRIPE_WEBHOOK_SECRET. Members can still send consult requests.
        </Notice>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name for one" htmlFor="adv-label" help="Such as Consultant, Coach or Mentor.">
          <Input id="adv-label" maxLength={LIMITS.label} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Name for many" htmlFor="adv-plural">
          <Input id="adv-plural" maxLength={LIMITS.label} value={plural} onChange={(e) => setPlural(e.target.value)} />
        </Field>
        <Field label="Default fee (percent)" htmlFor="adv-fee" help="New advisors start with this fee. You can change each advisor's fee.">
          <Input id="adv-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className="w-32" />
        </Field>
        <Field label="Currency" htmlFor="adv-currency" help="New offers use this currency.">
          <NativeSelect id="adv-currency" value={currency} onChange={(e) => setCurrency(e.target.value as AdvisorySettings["currency"])}>
            {CURRENCIES.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {c.toUpperCase()}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div className="grid gap-1">
          <Label htmlFor="adv-auto">Approve new profiles without review</Label>
          <p className="text-sm text-muted-foreground">When this is off, an owner or admin reviews each application first.</p>
        </div>
        <Switch id="adv-auto" checked={auto} onCheckedChange={setAuto} />
      </div>
      <div>
        <Button type="submit" disabled={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
