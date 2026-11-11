import { useState } from "react";
import { api, errorText, Field, Icon, Link, Modal, navigate, Notice, PageBody, SiteHeader, useToast } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent } from "@openact/ui/components/card";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Textarea } from "@openact/ui/components/textarea";
import { ADVISORY_HOME, LIMITS, formatPrice } from "../shared/rules";
import type { AdvisorProfile } from "../shared/types";
import { Empty, KindBadge, Portrait, Price } from "./bits";
import { API, useAdvisory, useLoad } from "./state";

/** The directory: every listed advisor, with their role and lowest price. */
export function DirectoryPage() {
  const { home, settings, error } = useAdvisory();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = (home?.advisors ?? []).filter((a) => !needle || a.name.toLowerCase().includes(needle) || a.headline.toLowerCase().includes(needle));
  const canSell = home?.can.sell && !home.myStatus;

  return (
    <>
      <SiteHeader title={settings.labelPlural}>
        {canSell && (
          <Button size="sm" variant="outline" onClick={() => navigate(`${ADVISORY_HOME}/me`)} data-become-advisor="">
            <Icon name="briefcase" /> <span className="hidden sm:inline">Become a {settings.label.toLowerCase()}</span>
          </Button>
        )}
      </SiteHeader>
      <PageBody>
        {error && <Notice tone="error">{error}</Notice>}
        <Input
          type="search"
          className="h-8 w-full sm:max-w-md"
          placeholder={`Find a ${settings.label.toLowerCase()} by name or role`}
          aria-label={`Find a ${settings.label.toLowerCase()}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {home && !home.advisors.length && (
          <Empty title={`No ${settings.labelPlural.toLowerCase()} yet`}>
            {home.can.sell ? `Be the first. Open My ${settings.label.toLowerCase()} page to write your profile and apply.` : "Check back soon."}
          </Empty>
        )}
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-advisor-grid="">
          {list.map((a) => (
            <li key={a.id}>
              <Link to={`${ADVISORY_HOME}/p/${a.id}`} className="block h-full rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <Card className="h-full gap-0 py-4 transition-colors hover:bg-accent/40">
                  <CardContent className="flex items-start gap-3 px-4">
                    <Portrait id={a.id} name={a.name} url={a.photoUrl} size={48} />
                    <div className="grid min-w-0 gap-1">
                      <span className="truncate font-medium">{a.name}</span>
                      <span className="line-clamp-2 text-sm text-muted-foreground">{a.headline}</span>
                      {a.fromPrice && (
                        <span className="text-sm">
                          From <Price price={a.fromPrice} kind={a.fromPrice.kind} />
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </PageBody>
    </>
  );
}

/** One advisor: the bio, the offers, Book a consult and Pay in advance. */
export function ProfilePage({ advisorId }: { advisorId: string }) {
  const { companyId, settings } = useAdvisory();
  const { data: p, error } = useLoad<AdvisorProfile>(companyId ? `${API}/companies/${companyId}/advisors/${advisorId}` : null);
  const [dialog, setDialog] = useState<null | "book" | "pay">(null);

  return (
    <>
      <SiteHeader title={p?.name ?? settings.label}>
        {p && !p.isMe && (
          <>
            <Button size="sm" variant="outline" onClick={() => setDialog("pay")} disabled={!p.offers.length} data-pay-advance="">
              <Icon name="card" /> <span className="hidden sm:inline">Pay in advance</span>
            </Button>
            <Button size="sm" onClick={() => setDialog("book")} data-book-consult="">
              <Icon name="calendar" /> Book a consult
            </Button>
          </>
        )}
      </SiteHeader>
      <PageBody>
        {error && <Notice tone="error">{error}</Notice>}
        {p && (
          <div className="grid max-w-3xl gap-6" data-advisor-profile={p.id}>
            <div className="flex items-start gap-4">
              <Portrait id={p.id} name={p.name} url={p.photoUrl} size={80} />
              <div className="grid min-w-0 gap-1">
                <h2 className="text-xl font-semibold">{p.name}</h2>
                <p className="text-muted-foreground">{p.headline}</p>
                {p.isMe && <p className="text-sm text-muted-foreground">This is how members see your profile.</p>}
              </div>
            </div>
            {p.bio && <p className="whitespace-pre-line leading-relaxed">{p.bio}</p>}

            <section className="grid gap-3">
              <h3 className="font-semibold">Offers</h3>
              {!p.offers.length && <p className="text-sm text-muted-foreground">No offers yet. Book a consult to ask about a price.</p>}
              {p.offers.map((o) => (
                <Card key={o.id} className="gap-2 py-4" data-offer={o.id}>
                  <CardContent className="grid gap-2 px-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{o.name}</span>
                      <span className="flex items-center gap-2">
                        <KindBadge kind={o.kind} />
                        <Price price={o.price} kind={o.kind} />
                      </span>
                    </div>
                    {o.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{o.description}</p>}
                  </CardContent>
                </Card>
              ))}
            </section>

            {!p.isMe && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setDialog("book")}>
                  <Icon name="calendar" /> Book a consult
                </Button>
                <Button variant="outline" onClick={() => setDialog("pay")} disabled={!p.offers.length}>
                  <Icon name="card" /> Pay in advance
                </Button>
              </div>
            )}
          </div>
        )}
      </PageBody>
      {p && dialog === "book" && <BookDialog profile={p} onClose={() => setDialog(null)} />}
      {p && dialog === "pay" && <PayAdvanceDialog profile={p} onClose={() => setDialog(null)} />}
    </>
  );
}

function BookDialog({ profile, onClose }: { profile: AdvisorProfile; onClose: () => void }) {
  const { companyId } = useAdvisory();
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [offerId, setOfferId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(`${API}/companies/${companyId}/advisors/${profile.id}/requests`, { body: { message, offerId: offerId || null } });
      toast(`Sent. ${profile.name} gets an email and replies on My requests.`);
      onClose();
      navigate(`${ADVISORY_HOME}/my`);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Book a consult with ${profile.name}`} description="Tell them what you need. They accept with a price, or decline." onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit} data-book-form="">
        {err && <Notice tone="error">{err}</Notice>}
        <Field label="What do you need help with?" htmlFor="adv-msg" help="Include your goal, your timeline and your budget.">
          <Textarea id="adv-msg" rows={6} maxLength={LIMITS.message} value={message} onChange={(e) => setMessage(e.target.value)} required />
        </Field>
        {profile.offers.length > 0 && (
          <Field label="Offer (optional)" htmlFor="adv-offer">
            <NativeSelect id="adv-offer" value={offerId} onChange={(e) => setOfferId(e.target.value)}>
              <NativeSelectOption value="">Not sure yet</NativeSelectOption>
              {profile.offers.map((o) => (
                <NativeSelectOption key={o.id} value={o.id}>
                  {o.name}, {formatPrice(o.price, o.kind)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !message.trim()}>
            <Icon name="send" /> Send request
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PayAdvanceDialog({ profile, onClose }: { profile: AdvisorProfile; onClose: () => void }) {
  const { companyId } = useAdvisory();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const choose = async (offerId: string) => {
    setBusy(offerId);
    setErr(null);
    try {
      const r = await api<{ id: string }>(`${API}/companies/${companyId}/advisors/${profile.id}/offers/${offerId}/buy`, { method: "POST" });
      onClose();
      navigate(`${ADVISORY_HOME}/pay/${r.id}`);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={`Pay ${profile.name} in advance`} description="Choose an offer. You review it, then pay with Stripe." onClose={onClose}>
      {!profile.payable && <Notice>{profile.name} cannot take payments yet. Book a consult instead.</Notice>}
      {err && <Notice tone="error">{err}</Notice>}
      <ul className="grid gap-2" data-pay-offers="">
        {profile.offers.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="grid min-w-0 gap-0.5">
              <span className="truncate font-medium">{o.name}</span>
              <span className="text-sm text-muted-foreground">
                <Price price={o.price} kind={o.kind} />
              </span>
            </div>
            <Button size="sm" disabled={!profile.payable || !!busy} onClick={() => choose(o.id)}>
              Choose
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
