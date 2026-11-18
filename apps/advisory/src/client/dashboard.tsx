import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, Field, fmtDateTime, Icon, Link, Modal, Notice, PageBody, SiteHeader, useShell, useToast } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent } from "@openact/ui/components/card";
import { Input } from "@openact/ui/components/input";
import { Label } from "@openact/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@openact/ui/components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@openact/ui/components/tabs";
import { Textarea } from "@openact/ui/components/textarea";
import { ADVISORY_HOME, LIMITS, formatMoney, formatPrice, parsePriceInput } from "../shared/rules";
import { OFFER_KINDS, OFFER_KIND_LABELS, type AdvisoryRequest, type Engagement, type MyAdvisor, type MyAdvisorPage, type Offer, type OfferKind } from "../shared/types";
import { AdvisorBadge, Empty, KindBadge, Portrait, Price, RequestBadge } from "./bits";
import { API, useAdvisory, useLoad } from "./state";

const TABS = ["requests", "offers", "clients", "earnings", "profile"] as const;
type Tab = (typeof TABS)[number];

const tabFromUrl = (): Tab | null => {
  const t = new URLSearchParams(window.location.search).get("tab");
  return (TABS as readonly string[]).includes(t ?? "") ? (t as Tab) : null;
};

/** The advisor dashboard: Requests, Offers, Clients, Earnings and Profile. A new advisor starts on Profile. */
export function DashboardPage() {
  const { companyId, settings, reload: reloadHome } = useAdvisory();
  const { data, error, reload } = useLoad<MyAdvisorPage>(companyId ? `${API}/companies/${companyId}/me` : null);
  const [tab, setTab] = useState<Tab>(() => tabFromUrl() ?? "requests");
  const a = data?.advisor ?? null;
  const live = a?.status === "approved";

  // A new advisor starts on Profile.
  useEffect(() => {
    if (data && !a && tab !== "profile") setTab("profile");
  }, [data, a, tab]);

  const changeTab = (t: string) => {
    setTab(t as Tab);
    window.history.replaceState(null, "", `${window.location.pathname}?tab=${t}`);
  };

  const refresh = async () => {
    await reload();
    await reloadHome();
  };

  return (
    <>
      <SiteHeader title={`My ${settings.label.toLowerCase()} page`}>
        {a && live && (
          <Button asChild size="sm" variant="outline">
            <Link to={`${ADVISORY_HOME}/p/${a.id}`}>
              <Icon name="external" /> <span className="hidden sm:inline">View my profile</span>
            </Link>
          </Button>
        )}
      </SiteHeader>
      <PageBody>
        {error && <Notice tone="error">{error}</Notice>}
        {data && <StatusBanner page={data} onChanged={refresh} />}
        {data && (
          <Tabs value={tab} onValueChange={changeTab} data-advisor-tabs="">
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="requests" disabled={!a}>
                Requests{data.counts.pending ? <Badge className="ml-1 h-5 px-1.5">{data.counts.pending}</Badge> : null}
              </TabsTrigger>
              <TabsTrigger value="offers" disabled={!a}>
                Offers
              </TabsTrigger>
              <TabsTrigger value="clients" disabled={!a}>
                Clients
              </TabsTrigger>
              <TabsTrigger value="earnings" disabled={!a}>
                Earnings
              </TabsTrigger>
              <TabsTrigger value="profile">Profile</TabsTrigger>
            </TabsList>
            <TabsContent value="requests">{a && <RequestsTab advisor={a} onChanged={refresh} />}</TabsContent>
            <TabsContent value="offers">{a && <OffersTab advisor={a} onChanged={refresh} />}</TabsContent>
            <TabsContent value="clients">{a && <EngagementsTab view="clients" />}</TabsContent>
            <TabsContent value="earnings">{a && <EarningsTab advisor={a} payments={data.payments} onChanged={refresh} />}</TabsContent>
            <TabsContent value="profile">
              <ProfileTab advisor={a} onChanged={refresh} />
            </TabsContent>
          </Tabs>
        )}
      </PageBody>
    </>
  );
}

function StatusBanner({ page, onChanged }: { page: MyAdvisorPage; onChanged: () => Promise<void> }) {
  const { companyId, settings } = useAdvisory();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const a = page.advisor;
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ status: string }>(`${API}/companies/${companyId}/me/submit`, { method: "POST" });
      toast(r.status === "approved" ? "Your profile is live." : "Sent for review. You get an email when it is decided.");
      await onChanged();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!a)
    return (
      <Notice tone="info">
        Write your profile to become a {settings.label.toLowerCase()}. Then add your offers and apply. {settings.approvalMode === "required" ? "A company admin reviews each application." : ""}
      </Notice>
    );
  const steps = [
    { done: !!a.headline && !!a.bio, label: "Write your profile" },
    { done: a.offers.length > 0, label: "Add an offer" },
    { done: a.stripe.ready, label: "Connect Stripe to get paid" }
  ];
  return (
    <Card className="gap-3 py-4" data-advisor-banner={a.status}>
      <CardContent className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <span className="font-medium">Your profile</span>
            <AdvisorBadge status={a.status} />
            {a.status === "approved" && <span className="text-xs text-muted-foreground">Brand fee: {a.feePercent}%</span>}
          </div>
          {(a.status === "draft" || a.status === "declined") && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {steps.map((s) => (
                <li key={s.label} className={s.done ? "text-foreground" : "text-muted-foreground"}>
                  <Icon name={s.done ? "check" : "clock"} size={14} className="mr-1 inline" />
                  {s.label}
                </li>
              ))}
            </ul>
          )}
          {a.status === "pending" && <p className="text-sm text-muted-foreground">A company admin reviews your profile. You get an email when it is decided.</p>}
          {a.status === "paused" && <p className="text-sm text-muted-foreground">A company admin paused your profile. Members cannot see it now.</p>}
          {a.status === "declined" && a.declineNote && <p className="text-sm text-muted-foreground">Note from the review: {a.declineNote}</p>}
          {a.status === "approved" && !a.stripe.ready && page.payments && (
            <p className="text-sm text-muted-foreground">Connect Stripe on the Earnings tab, so clients can pay you.</p>
          )}
        </div>
        {(a.status === "draft" || a.status === "declined") && (
          <Button onClick={submit} disabled={busy || !steps[0]!.done || !steps[1]!.done} data-apply="">
            <Icon name="send" /> {a.status === "declined" ? "Apply again" : "Apply"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/* Profile */

function ProfileTab({ advisor, onChanged }: { advisor: MyAdvisor | null; onChanged: () => Promise<void> }) {
  const { companyId } = useAdvisory();
  const toast = useToast();
  const [headline, setHeadline] = useState(advisor?.headline ?? "");
  const [bio, setBio] = useState(advisor?.bio ?? "");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { me } = useShell();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`${API}/companies/${companyId}/me/profile`, { method: "PUT", body: { headline, bio } });
      toast("Profile saved.");
      await onChanged();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    try {
      await api(`${API}/companies/${companyId}/me/photo`, { form, method: "POST" });
      toast("Photo saved.");
      await onChanged();
    } catch (e) {
      toast(errorText(e));
    }
  };

  const removePhoto = async () => {
    try {
      await api(`${API}/companies/${companyId}/me/photo`, { method: "DELETE" });
      await onChanged();
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <form className="grid max-w-2xl gap-5 pt-2" onSubmit={save} data-profile-form="">
      {advisor && (
        <div className="flex items-center gap-4">
          <Portrait id={advisor.id} name={me?.name || "You"} url={advisor.photoUrl} size={64} />
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
            <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" /> {advisor.photoUrl ? "Change photo" : "Add a photo"}
            </Button>
            {advisor.photoUrl && (
              <Button type="button" size="sm" variant="ghost" onClick={removePhoto}>
                Remove
              </Button>
            )}
          </div>
        </div>
      )}
      <Field label="Role" htmlFor="adv-headline" help="What you do, in a few words, such as Fractional CMO or B2B sales coach.">
        <Input id="adv-headline" maxLength={LIMITS.headline} value={headline} onChange={(e) => setHeadline(e.target.value)} required />
      </Field>
      <Field label="Bio" htmlFor="adv-bio" help="Who you help, how you help, and the results you get.">
        <Textarea id="adv-bio" rows={8} maxLength={LIMITS.bio} value={bio} onChange={(e) => setBio(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" disabled={busy || !headline.trim()}>
          {advisor ? "Save profile" : "Create my profile"}
        </Button>
      </div>
      {!advisor && <p className="text-xs text-muted-foreground">You can add a photo after you create your profile.</p>}
    </form>
  );
}

/* Offers */

function OffersTab({ advisor, onChanged }: { advisor: MyAdvisor; onChanged: () => Promise<void> }) {
  const { companyId } = useAdvisory();
  const toast = useToast();
  const [edit, setEdit] = useState<Offer | "new" | null>(null);
  const archive = async (o: Offer) => {
    try {
      await api(`${API}/companies/${companyId}/me/offers/${o.id}`, { method: "DELETE" });
      toast(`Archived "${o.name}".`);
      await onChanged();
    } catch (e) {
      toast(errorText(e));
    }
  };
  return (
    <div className="grid gap-3 pt-2" data-offers-tab="">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Clients choose an offer to pay in advance. You can also use an offer when you accept a request.</p>
        <Button size="sm" onClick={() => setEdit("new")} disabled={advisor.offers.length >= LIMITS.offersPerAdvisor} data-new-offer="">
          <Icon name="plus" /> New offer
        </Button>
      </div>
      {!advisor.offers.length && <Empty title="No offers yet">Add a one-time session or a monthly retainer.</Empty>}
      {advisor.offers.map((o) => (
        <Card key={o.id} className="gap-2 py-4" data-my-offer={o.id}>
          <CardContent className="flex flex-col gap-2 px-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="grid min-w-0 gap-1">
              <span className="font-medium">{o.name}</span>
              {o.description && <p className="line-clamp-3 text-sm text-muted-foreground">{o.description}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <KindBadge kind={o.kind} />
              <Price price={o.price} kind={o.kind} />
              <Button size="icon-sm" variant="ghost" onClick={() => setEdit(o)} aria-label={`Edit ${o.name}`}>
                <Icon name="pencil" />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => archive(o)} aria-label={`Archive ${o.name}`}>
                <Icon name="trash" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {edit && <OfferDialog offer={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={onChanged} />}
    </div>
  );
}

function OfferFields({
  name,
  setName,
  price,
  setPrice,
  kind,
  setKind,
  currency
}: {
  name: string;
  setName: (v: string) => void;
  price: string;
  setPrice: (v: string) => void;
  kind: OfferKind;
  setKind: (v: OfferKind) => void;
  currency: string;
}) {
  return (
    <>
      <Field label="Name" htmlFor="offer-name">
        <Input id="offer-name" maxLength={LIMITS.offerName} value={name} onChange={(e) => setName(e.target.value)} placeholder="One-hour strategy session" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Price (${currency.toUpperCase()})`} htmlFor="offer-price">
          <Input id="offer-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="500" required />
        </Field>
        <Field label="Type" htmlFor="offer-kind">
          <NativeSelect id="offer-kind" value={kind} onChange={(e) => setKind(e.target.value as OfferKind)}>
            {OFFER_KINDS.map((k) => (
              <NativeSelectOption key={k} value={k}>
                {OFFER_KIND_LABELS[k]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>
    </>
  );
}

function OfferDialog({ offer, onClose, onSaved }: { offer: Offer | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { companyId, settings } = useAdvisory();
  const toast = useToast();
  const [name, setName] = useState(offer?.name ?? "");
  const [description, setDescription] = useState(offer?.description ?? "");
  const [price, setPrice] = useState(offer ? String(offer.price.amount / 100) : "");
  const [kind, setKind] = useState<OfferKind>(offer?.kind ?? "one_time");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parsePriceInput(price);
    if (cents === null) return setErr("Type the price as a number, such as 500 or 1200.50.");
    setBusy(true);
    setErr(null);
    try {
      const body = { name, description, price: cents, kind };
      if (offer) await api(`${API}/companies/${companyId}/me/offers/${offer.id}`, { method: "PATCH", body });
      else await api(`${API}/companies/${companyId}/me/offers`, { body });
      toast(offer ? "Offer saved." : "Offer added.");
      await onSaved();
      onClose();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={offer ? "Edit offer" : "New offer"} description={offer ? "A new price applies to new purchases only." : undefined} onClose={onClose}>
      <form className="grid gap-4" onSubmit={save} data-offer-form="">
        {err && <Notice tone="error">{err}</Notice>}
        <OfferFields name={name} setName={setName} price={price} setPrice={setPrice} kind={kind} setKind={setKind} currency={offer?.price.currency ?? settings.currency} />
        <Field label="Description" htmlFor="offer-desc" help="What the client gets.">
          <Textarea id="offer-desc" rows={4} maxLength={LIMITS.offerDescription} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* Requests */

function RequestsTab({ advisor, onChanged }: { advisor: MyAdvisor; onChanged: () => Promise<void> }) {
  const { companyId } = useAdvisory();
  const { data, error, reload } = useLoad<{ requests: AdvisoryRequest[] }>(`${API}/companies/${companyId}/me/requests`);
  const [accept, setAccept] = useState<AdvisoryRequest | null>(null);
  const [decline, setDecline] = useState<AdvisoryRequest | null>(null);
  const list = data?.requests ?? [];
  const done = async () => {
    await reload();
    await onChanged();
  };
  return (
    <div className="grid gap-3 pt-2" data-requests-tab="">
      {error && <Notice tone="error">{error}</Notice>}
      {data && !list.length && <Empty title="No requests yet">Requests and purchases from clients show here.</Empty>}
      {list.map((r) => (
        <Card key={r.id} className="gap-2 py-4" data-incoming={r.id}>
          <CardContent className="grid gap-2 px-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="grid">
                <span className="font-medium">{r.client.name}</span>
                {r.client.email && <span className="text-xs text-muted-foreground">{r.client.email}</span>}
              </div>
              <div className="flex items-center gap-2">
                {r.source === "direct" && <Badge variant="outline">Pay in advance</Badge>}
                <RequestBadge status={r.status} />
              </div>
            </div>
            {r.message && <p className="whitespace-pre-line text-sm">{r.message}</p>}
            {r.terms && (
              <p className="text-sm">
                {r.terms.name}, <Price price={r.terms.price} kind={r.terms.kind} />
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{fmtDateTime(r.createdAt)}</span>
              <span className="ml-auto flex gap-2">
                {r.status === "pending" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setDecline(r)}>
                      Decline
                    </Button>
                    <Button size="sm" onClick={() => setAccept(r)} disabled={advisor.status !== "approved"} data-accept="">
                      <Icon name="check" /> Accept
                    </Button>
                  </>
                )}
                {r.status === "accepted" && (
                  <Button asChild size="sm" variant="outline">
                    <Link to={`${ADVISORY_HOME}/pay/${r.id}`}>Payment page</Link>
                  </Button>
                )}
                {r.engagement?.projectPath && (
                  <Button asChild size="sm" variant="outline">
                    <Link to={r.engagement.projectPath}>
                      <Icon name="projects" /> Project
                    </Link>
                  </Button>
                )}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
      {accept && <AcceptDialog advisor={advisor} request={accept} onClose={() => setAccept(null)} onDone={done} />}
      {decline && <DeclineDialog request={decline} onClose={() => setDecline(null)} onDone={done} />}
    </div>
  );
}

function AcceptDialog({ advisor, request, onClose, onDone }: { advisor: MyAdvisor; request: AdvisoryRequest; onClose: () => void; onDone: () => Promise<void> }) {
  const { companyId, settings } = useAdvisory();
  const toast = useToast();
  const [choice, setChoice] = useState<string>(request.offerId && advisor.offers.some((o) => o.id === request.offerId) ? request.offerId : (advisor.offers[0]?.id ?? "custom"));
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [kind, setKind] = useState<OfferKind>("one_time");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    let body: Record<string, unknown>;
    if (choice === "custom") {
      const cents = parsePriceInput(price);
      if (cents === null) return setErr("Type the price as a number, such as 500 or 1200.50.");
      body = { custom: { name, price: cents, kind } };
    } else body = { offerId: choice };
    setBusy(true);
    setErr(null);
    try {
      await api(`${API}/companies/${companyId}/me/requests/${request.id}/accept`, { body });
      toast(`Accepted. ${request.client.name} gets an email with the payment page.`);
      await onDone();
      onClose();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Accept ${request.client.name}'s request`} description="Choose the price. The client gets a link to a payment page." onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit} data-accept-form="">
        {err && <Notice tone="error">{err}</Notice>}
        <div className="grid gap-2" role="radiogroup" aria-label="Price">
          {advisor.offers.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[:checked]:border-primary">
              <input type="radio" name="choice" value={o.id} checked={choice === o.id} onChange={() => setChoice(o.id)} />
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              <span className="text-sm">{formatPrice(o.price, o.kind)}</span>
            </label>
          ))}
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[:checked]:border-primary">
            <input type="radio" name="choice" value="custom" checked={choice === "custom"} onChange={() => setChoice("custom")} />
            <span>A custom price</span>
          </label>
        </div>
        {choice === "custom" && <OfferFields name={name} setName={setName} price={price} setPrice={setPrice} kind={kind} setKind={setKind} currency={settings.currency} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Accept and send the payment link
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeclineDialog({ request, onClose, onDone }: { request: AdvisoryRequest; onClose: () => void; onDone: () => Promise<void> }) {
  const { companyId } = useAdvisory();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`${API}/companies/${companyId}/me/requests/${request.id}/decline`, { body: { note } });
      toast("Declined.");
      await onDone();
      onClose();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Decline ${request.client.name}'s request`} onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="Note (optional)" htmlFor="decline-note" help="The client sees this note.">
          <Textarea id="decline-note" rows={3} maxLength={LIMITS.note} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={busy}>
            Decline
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* Clients and earnings */

function useEngagements() {
  const { companyId } = useAdvisory();
  return useLoad<{ engagements: Engagement[] }>(`${API}/companies/${companyId}/me/engagements`);
}

export function EngagementTable({ list, show }: { list: Engagement[]; show: "clients" | "earnings" | "all" }) {
  const { settings } = useAdvisory();
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table data-engagements={show}>
        <TableHeader>
          <TableRow>
            {show === "all" && <TableHead>{settings.label}</TableHead>}
            <TableHead>Client</TableHead>
            <TableHead>Offer</TableHead>
            <TableHead className="text-right">Price</TableHead>
            {show !== "clients" && <TableHead className="text-right">Brand fee</TableHead>}
            {show === "earnings" && <TableHead className="text-right">You get</TableHead>}
            <TableHead className="hidden md:table-cell">Started</TableHead>
            <TableHead>Status</TableHead>
            {show !== "earnings" && <TableHead className="text-right">Project</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((e) => (
            <TableRow key={e.id} data-engagement={e.id}>
              {show === "all" && <TableCell>{e.advisor.name}</TableCell>}
              <TableCell className="font-medium">{e.client.name}</TableCell>
              <TableCell>{e.terms.name}</TableCell>
              <TableCell className="text-right">
                <Price price={e.terms.price} kind={e.terms.kind} />
              </TableCell>
              {show !== "clients" && <TableCell className="text-right tabular">{formatMoney(e.fee)}</TableCell>}
              {show === "earnings" && <TableCell className="text-right tabular">{formatMoney({ amount: e.terms.price.amount - e.fee.amount, currency: e.fee.currency })}</TableCell>}
              <TableCell className="hidden text-muted-foreground md:table-cell">{fmtDateTime(e.createdAt)}</TableCell>
              <TableCell>
                <Badge variant={e.status === "active" ? "default" : "outline"}>{e.status === "active" ? "Active" : "Ended"}</Badge>
              </TableCell>
              {show !== "earnings" && (
                <TableCell className="text-right">
                  {e.projectPath ? (
                    <Button asChild size="xs" variant="outline">
                      <Link to={e.projectPath}>Open</Link>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">None</span>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EngagementsTab({ view }: { view: "clients" }) {
  const { data, error } = useEngagements();
  const list = data?.engagements ?? [];
  return (
    <div className="grid gap-3 pt-2">
      {error && <Notice tone="error">{error}</Notice>}
      {data && !list.length && <Empty title="No clients yet">When a client pays, a project opens for the two of you. It shows here.</Empty>}
      {list.length > 0 && <EngagementTable list={list} show={view} />}
    </div>
  );
}

function EarningsTab({ advisor, payments, onChanged }: { advisor: MyAdvisor; payments: boolean; onChanged: () => Promise<void> }) {
  const { companyId } = useAdvisory();
  const toast = useToast();
  const { data, error } = useEngagements();
  const [busy, setBusy] = useState(false);
  const checked = useRef(false);
  const list = data?.engagements ?? [];

  const totals = useMemo(() => {
    const by = new Map<string, { gross: number; fee: number }>();
    for (const e of list) {
      const t = by.get(e.terms.price.currency) ?? { gross: 0, fee: 0 };
      t.gross += e.terms.price.amount;
      t.fee += e.fee.amount;
      by.set(e.terms.price.currency, t);
    }
    return [...by.entries()];
  }, [list]);

  const refresh = async (quiet = false) => {
    try {
      const r = await api<{ ready: boolean }>(`${API}/companies/${companyId}/me/stripe/refresh`, { method: "POST" });
      if (!quiet) toast(r.ready ? "Stripe is ready. Clients can pay you." : "Stripe needs more details. Continue the setup.");
      await onChanged();
    } catch (e) {
      toast(errorText(e));
    }
  };

  // Back from Stripe onboarding: read the account status now.
  useEffect(() => {
    if (checked.current || !new URLSearchParams(window.location.search).get("stripe") || !advisor.stripe.connected) return;
    checked.current = true;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advisor.stripe.connected]);

  const go = async (path: "connect" | "dashboard") => {
    setBusy(true);
    try {
      const r = await api<{ url: string }>(`${API}/companies/${companyId}/me/stripe/${path}`, { method: "POST" });
      if (path === "dashboard") window.open(r.url, "_blank", "noopener");
      else window.location.assign(r.url);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 pt-2" data-earnings-tab="">
      <Card className="gap-2 py-4">
        <CardContent className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid gap-1">
            <span className="flex items-center gap-2 font-medium">
              <Icon name="wallet" /> Payouts with Stripe
              {advisor.stripe.ready ? <Badge>Ready</Badge> : advisor.stripe.connected ? <Badge variant="secondary">Setup not finished</Badge> : <Badge variant="outline">Not connected</Badge>}
            </span>
            <p className="text-sm text-muted-foreground">
              {payments
                ? "Clients pay through Stripe. Stripe sends your share to your bank. The brand fee is kept from each payment."
                : "Payments are not set up on this site yet. Ask the person who runs it to connect Stripe."}
            </p>
          </div>
          {payments && (
            <div className="flex shrink-0 gap-2">
              {advisor.stripe.ready ? (
                <Button size="sm" variant="outline" onClick={() => go("dashboard")} disabled={busy}>
                  <Icon name="external" /> Stripe dashboard
                </Button>
              ) : (
                <>
                  {advisor.stripe.connected && (
                    <Button size="sm" variant="ghost" onClick={() => refresh()} disabled={busy}>
                      Check again
                    </Button>
                  )}
                  <Button size="sm" onClick={() => go("connect")} disabled={busy} data-connect-stripe="">
                    <Icon name="plug" /> {advisor.stripe.connected ? "Continue setup" : "Connect Stripe"}
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}
      {totals.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {totals.map(([cur, t]) => (
            <div key={cur} className="contents">
              <Stat label={`Paid by clients (${cur.toUpperCase()})`} value={formatMoney({ amount: t.gross, currency: cur })} />
              <Stat label="Brand fees" value={formatMoney({ amount: t.fee, currency: cur })} />
              <Stat label="Your share" value={formatMoney({ amount: t.gross - t.fee, currency: cur })} />
            </div>
          ))}
        </div>
      )}
      {totals.length > 0 && <p className="text-xs text-muted-foreground">Totals count the first payment of each engagement. See every retainer payment in your Stripe dashboard.</p>}
      {data && !list.length && <Empty title="No payments yet" />}
      {list.length > 0 && <EngagementTable list={list} show="earnings" />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="grid gap-1 px-4">
        <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
        <span className="text-xl font-semibold tabular">{value}</span>
      </CardContent>
    </Card>
  );
}
