import { useState } from "react";
import { COMPANY_ROLE_LABELS, type PendingInvitation } from "@openact/core/shared";
import { api, errorText } from "../api";
import { navigate } from "../router";
import { Logo, Notice } from "../ui";
import { useWorkspace } from "../workspace";
import { Button } from "@openact/ui/components/button";

/** One line for what the person is invited to. */
function what(i: PendingInvitation): string {
  const role = COMPANY_ROLE_LABELS[i.role].toLowerCase();
  const article = /^[aeiou]/.test(role) ? "an" : "a";
  const by = i.inviterName ? `${i.inviterName} invited you` : "You are invited";
  return `${by} to ${i.companyName} as ${article} ${role}${i.workspaceName ? `, in ${i.workspaceName}` : ""}.`;
}

/** Pending invitations with Accept and Decline. The person joins only when they accept. */
export function InvitationList({ invitations, onChanged }: { invitations: PendingInvitation[]; onChanged: () => Promise<void> }) {
  const ws = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (i: PendingInvitation, action: "accept" | "decline") => {
    setBusy(i.id);
    setError(null);
    try {
      const r = await api<{ ok: true; companyId?: string }>(`/api/invitations/${i.id}/${action}`, { method: "POST" });
      if (action === "accept" && r.companyId) {
        await ws.reloadCompanies();
        await ws.switchTo(r.companyId);
        navigate("/");
      }
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-3" data-invitations="">
      {invitations.map((i) => (
        <div key={i.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-sm font-medium">{what(i)}</span>
            <span className="text-xs text-muted-foreground">Expires {new Date(i.expiresAt).toLocaleDateString()}.</span>
          </div>
          <div className="flex gap-2">
            <Button type="button" disabled={busy !== null} onClick={() => answer(i, "accept")}>
              Accept
            </Button>
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => answer(i, "decline")}>
              Decline
            </Button>
          </div>
        </div>
      ))}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

/** A banner above the page for a person who is in a company and has more invitations. */
export function InvitationBanner({ invitations, onChanged }: { invitations: PendingInvitation[]; onChanged: () => Promise<void> }) {
  if (!invitations.length) return null;
  return (
    <div className="border-b bg-muted/40 px-4 py-3 sm:px-6">
      <InvitationList invitations={invitations} onChanged={onChanged} />
    </div>
  );
}

/** The first screen for a person with no company and an invitation. */
export function AcceptInvite({
  appName,
  logoUrl,
  email,
  invitations,
  onChanged
}: {
  appName: string;
  logoUrl: string | null;
  email: string;
  invitations: PendingInvitation[];
  onChanged: () => Promise<void>;
}) {
  return (
    <main className="min-h-dvh bg-muted/40" data-accept-invite="">
      <header className="flex h-16 items-center gap-3 px-6 sm:px-10">
        <Logo src={logoUrl} size={28} />
        <span className="text-lg font-semibold">{appName}</span>
        <span className="ml-auto hidden text-sm text-muted-foreground sm:inline">Signed in as {email}</span>
      </header>
      <div className="mx-auto grid w-full max-w-xl gap-6 px-6 pb-16 pt-6">
        <div className="grid gap-6 rounded-2xl border bg-card p-6 sm:p-10">
          <div className="grid gap-2">
            <h1 className="text-2xl font-semibold">{invitations.length > 1 ? "You have invitations" : "You have an invitation"}</h1>
            <p className="text-sm text-muted-foreground">You join only when you accept. Decline if you do not know the sender.</p>
          </div>
          <InvitationList invitations={invitations} onChanged={onChanged} />
        </div>
      </div>
    </main>
  );
}
