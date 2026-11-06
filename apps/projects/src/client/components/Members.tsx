import { useState } from "react";
import { ROLES, ROLE_LABELS, type AccessRequest, type ProjectDetail, type Role, type User } from "../../shared/types";
import { api, errorText } from "@openact/ui";
import { navigate } from "@openact/ui";
import { Avatar, ConfirmButton, useToast } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Badge } from "@openact/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@openact/ui/components/card";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import type { ReactNode } from "react";

const ROLE_HELP: Record<Role, string> = {
  owner: "Manages people and settings. Can delete the project.",
  editor: "Adds, edits and moves tasks. Attaches files.",
  viewer: "Sees the board and timeline. Cannot make changes."
};

export function Members({ data, me, isOwner, onChanged }: { data: ProjectDetail; me: User; isOwner: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [busy, setBusy] = useState(false);
  const pid = data.project.id;

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ added: "member" | "invitation" }>(`/api/projects/${pid}/members`, { body: { email, role } });
      toast(r.added === "member" ? "Added. We sent them an email." : "Invitation sent. They join when they sign in.");
      setEmail("");
      onChanged();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (userId: string, next: Role) => {
    try {
      await api(`/api/projects/${pid}/members/${userId}`, { method: "PATCH", body: { role: next } });
      toast("Role changed.");
    } catch (err) {
      toast(errorText(err));
    }
    onChanged();
  };

  const remove = async (userId: string) => {
    try {
      await api(`/api/projects/${pid}/members/${userId}`, { method: "DELETE" });
      if (userId === me.id) {
        toast("You left the project.");
        navigate("/");
        return;
      }
      toast("Removed from the project.");
    } catch (err) {
      toast(errorText(err));
    }
    onChanged();
  };

  const revoke = async (id: string) => {
    try {
      await api(`/api/projects/${pid}/invitations/${id}`, { method: "DELETE" });
      toast("Invitation canceled.");
    } catch (err) {
      toast(errorText(err));
    }
    onChanged();
  };

  const roleOptions = ROLES.map((r) => (
    <NativeSelectOption key={r} value={r}>
      {ROLE_LABELS[r]}
    </NativeSelectOption>
  ));
  return (
    <div className="grid max-w-3xl gap-6" data-members="">
      {isOwner && (
        <Card className="gap-4 shadow-xs">
          <CardHeader>
            <CardTitle>Invite people</CardTitle>
            <CardDescription>There is no limit on people. Each person signs in with their email and a one-time code.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-2" onSubmit={invite}>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="email"
                  required
                  placeholder="name@company.com"
                  aria-label="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="sm:flex-1"
                />
                <NativeSelect aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {roleOptions}
                </NativeSelect>
                <Button type="submit" disabled={busy || !email.trim()}>
                  Send invitation
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{ROLE_HELP[role]}</p>
            </form>
          </CardContent>
        </Card>
      )}

      {isOwner && data.accessRequests.length > 0 && (
        <PeopleSection title="Access requests" count={data.accessRequests.length}>
          {data.accessRequests.map((r) => (
            <AccessRequestRow key={r.id} projectId={pid} request={r} onDone={onChanged} />
          ))}
        </PeopleSection>
      )}

      <PeopleSection
        title="People"
        count={data.members.length}
        description={
          data.project.visibility === "secret"
            ? "This project is secret. Only the people below can see it."
            : "Everyone in the company can also see this project as a viewer. Company owners and admins can manage it. Make the project secret in Project settings to limit it to the people below."
        }
      >
        {data.members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar id={m.userId} name={m.name || m.email} size={34} />
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-sm font-medium">
                {m.name || m.email}
                {m.userId === me.id && <span className="font-normal text-muted-foreground"> (you)</span>}
              </span>
              <span className="truncate text-xs text-muted-foreground">{m.email}</span>
            </span>
            {isOwner ? (
              <NativeSelect
                size="sm"
                aria-label={`Role for ${m.name || m.email}`}
                value={m.role}
                onChange={(e) => changeRole(m.userId, e.target.value as Role)}
              >
                {roleOptions}
              </NativeSelect>
            ) : (
              <Badge variant="secondary">{ROLE_LABELS[m.role]}</Badge>
            )}
            {(isOwner || m.userId === me.id) && (
              <ConfirmButton label={m.userId === me.id ? "Leave" : "Remove"} confirmLabel="Click to confirm" onConfirm={() => remove(m.userId)} />
            )}
          </li>
        ))}
      </PeopleSection>

      {isOwner && data.invitations.length > 0 && (
        <PeopleSection title="Waiting to join" count={data.invitations.length}>
          {data.invitations.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span
                className="flex size-[34px] shrink-0 items-center justify-center rounded-full border border-dashed text-sm text-muted-foreground"
                aria-hidden="true"
              >
                @
              </span>
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate font-mono text-sm">{i.email}</span>
                <span className="text-xs text-muted-foreground">Invited as {ROLE_LABELS[i.role].toLowerCase()}. They join the first time they sign in.</span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => revoke(i.id)}>
                Cancel invitation
              </Button>
            </li>
          ))}
        </PeopleSection>
      )}
    </div>
  );
}

function PeopleSection({ title, count, description, children }: { title: string; count: number; description?: string; children: ReactNode }) {
  return (
    <Card className="gap-0 py-0 shadow-xs">
      <CardHeader className="border-b py-4 [.border-b]:pb-4">
        <CardTitle className="flex items-center gap-2">
          {title}
          <Badge variant="secondary" className="h-5 min-w-5 rounded-full px-1.5 tabular">
            {count}
          </Badge>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <ul className="divide-y" data-people="">
        {children}
      </ul>
    </Card>
  );
}

function AccessRequestRow({ projectId, request, onDone }: { projectId: string; request: AccessRequest; onDone: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState<Role>("viewer");
  const [busy, setBusy] = useState(false);
  const answer = async (approve: boolean) => {
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/access-requests/${request.id}`, { body: approve ? { approve, role } : { approve } });
      toast(approve ? `${request.name || request.email} can now open the project.` : "Request declined.");
      onDone();
    } catch (err) {
      toast(errorText(err));
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Avatar id={request.userId} name={request.name || request.email} size={34} />
      <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
        <span className="truncate text-sm font-medium">{request.name || request.email}</span>
        <span className="truncate text-xs text-muted-foreground">{request.email}</span>
        {request.note && <span className="mt-1 rounded-md bg-muted px-2 py-1 text-xs">{request.note}</span>}
      </span>
      <NativeSelect
        size="sm"
        aria-label={`Role for ${request.name || request.email}`}
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        disabled={busy}
      >
        {ROLES.map((r) => (
          <NativeSelectOption key={r} value={r}>
            {ROLE_LABELS[r]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => answer(false)}>
        Decline
      </Button>
      <Button type="button" size="sm" disabled={busy} onClick={() => answer(true)}>
        Approve
      </Button>
    </li>
  );
}
