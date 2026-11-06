import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGENT_LEVELS,
  AGENT_LEVEL_LABELS,
  AGENT_SCOPES,
  AGENT_SCOPE_LABELS,
  COMPANY_ROLES,
  COMPANY_ROLE_HELP,
  COMPANY_ROLE_LABELS,
  ROLE_LABELS,
  type AgentLevel,
  type AgentScope,
  type AiPolicy,
  type Company,
  type CompanyDetail,
  type CompanyRole,
  type Role,
  type User
} from "../../shared/types";
import { ROLE_CEILING, levelRank } from "../../shared/agent-policy";
import { api, errorText } from "../api";
import { navigate } from "../router";
import { Avatar, ConfirmButton, Field, Modal, Notice, useToast } from "../ui";
import { useWorkspace } from "../workspace";
import { CompanyMark } from "./Sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function NewCompanyDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ company: Company }>("/api/companies", { body: { name } });
      await ws.reloadCompanies();
      await ws.switchTo(r.company.id);
      toast(`Created "${r.company.name}".`);
      navigate("/");
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Create a company"
      description="A company holds projects and people. You are its owner. You can invite people and add a logo next."
      onClose={onClose}
    >
      <form className="grid gap-4" onSubmit={create}>
        <Field label="Company name" htmlFor="nc-name">
          <Input id="nc-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Acme Studio" />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            Create company
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type Tab = "general" | "people" | "ai";

/** Company settings for owners and admins: name, logo, email domain, people and AI defaults. */
export function CompanySettings({ companyId, me, onClose }: { companyId: string; me: User; onClose: () => void }) {
  const ws = useWorkspace();
  const [tab, setTab] = useState<Tab>("general");
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api<CompanyDetail>(`/api/companies/${companyId}`));
    } catch (e) {
      setError(errorText(e));
    }
  }, [companyId]);
  useEffect(() => {
    load();
  }, [load]);

  const changed = async () => {
    await load();
    await ws.reloadCompanies();
  };

  return (
    <Modal title="Company settings" onClose={onClose} wide>
      {error && <Notice tone="error">{error}</Notice>}
      {!detail && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {detail && (
        <div className="grid gap-4">
          <div className="flex items-center gap-3" data-company-head="">
            <CompanyMark company={detail} size={40} />
            <div className="grid min-w-0 gap-0.5">
              <span className="truncate font-semibold">{detail.name}</span>
              <span className="text-xs text-muted-foreground">You are {detail.role === "admin" ? "an admin" : "the owner"} of this company.</span>
            </div>
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList aria-label="Company settings">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="people">People ({detail.members.length})</TabsTrigger>
              <TabsTrigger value="ai">AI defaults</TabsTrigger>
            </TabsList>
            <TabsContent value="general" className="pt-2">
              <GeneralTab detail={detail} me={me} onChanged={changed} onDeleted={onClose} />
            </TabsContent>
            <TabsContent value="people" className="pt-2">
              <PeopleTab detail={detail} me={me} onChanged={changed} />
            </TabsContent>
            <TabsContent value="ai" className="pt-2">
              <AiDefaultsTab detail={detail} onChanged={changed} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </Modal>
  );
}

function GeneralTab({ detail, me, onChanged, onDeleted }: { detail: CompanyDetail; me: User; onChanged: () => Promise<void>; onDeleted: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [name, setName] = useState(detail.name);
  const [domain, setDomain] = useState(detail.emailDomain ?? "");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const myDomain = me.email.split("@")[1] ?? "";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/companies/${detail.id}`, { method: "PATCH", body: { name, emailDomain: domain.trim() || null } });
      toast("Company saved.");
      await onChanged();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    const form = new FormData();
    form.append("file", f);
    try {
      await api(`/api/companies/${detail.id}/logo`, { method: "PUT", form });
      toast("Logo saved.");
      await onChanged();
    } catch (err) {
      toast(errorText(err));
    } finally {
      if (file.current) file.current.value = "";
    }
  };

  const removeLogo = async () => {
    try {
      await api(`/api/companies/${detail.id}/logo`, { method: "DELETE" });
      toast("Logo removed.");
      await onChanged();
    } catch (err) {
      toast(errorText(err));
    }
  };

  const remove = async () => {
    try {
      await api(`/api/companies/${detail.id}`, { method: "DELETE" });
      toast("Company deleted.");
      await ws.reloadCompanies();
      navigate("/");
      onDeleted();
    } catch (err) {
      toast(errorText(err));
    }
  };

  return (
    <div className="grid gap-6">
      <form className="grid gap-5" onSubmit={save}>
        <Field label="Company name" htmlFor="cs-name">
          <Input id="cs-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Logo" help="PNG, JPEG or WebP, up to 1 MB. A square image looks best.">
          <div className="flex flex-wrap items-center gap-3">
            <CompanyMark company={detail} size={48} />
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              id="cs-logo"
              onChange={(e) => upload(e.target.files?.[0])}
            />
            <Button asChild variant="outline" size="sm">
              <label htmlFor="cs-logo" className="cursor-pointer">
                {detail.logoUrl ? "Replace logo" : "Upload logo"}
              </label>
            </Button>
            {detail.logoUrl && (
              <Button type="button" variant="ghost" size="sm" onClick={removeLogo}>
                Remove
              </Button>
            )}
          </div>
        </Field>
        <Field
          label="Email domain for auto-join"
          htmlFor="cs-domain"
          help="People who sign in with an email at this domain join the company as members. Leave it empty to turn this off. Your own email must use the domain, and public domains such as gmail.com do not work."
        >
          <Input id="cs-domain" value={domain} maxLength={253} placeholder={myDomain || "example.com"} onChange={(e) => setDomain(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !name.trim()}>
            Save
          </Button>
        </div>
      </form>
      {detail.role === "owner" && (
        <>
          <Separator />
          <div className="grid gap-2 rounded-lg border border-destructive/30 p-4">
            <h3 className="text-sm font-medium">Delete company</h3>
            <p className="text-sm text-muted-foreground">Deleting a company removes all its projects, tasks and files for everyone. You cannot undo it.</p>
            <div>
              <ConfirmButton label="Delete company" confirmLabel="Click again to delete the company and all its projects" onConfirm={remove} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PeopleTab({ detail, me, onChanged }: { detail: CompanyDetail; me: User; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const isOwner = detail.role === "owner";
  const ownerCount = detail.members.filter((m) => m.role === "owner").length;

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ added: "member" | "invitation" }>(`/api/companies/${detail.id}/members`, { body: { email, role } });
      toast(r.added === "member" ? "Added. We sent them an email." : "Invitation sent. They join when they sign in.");
      setEmail("");
      await onChanged();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (userId: string, next: CompanyRole) => {
    try {
      await api(`/api/companies/${detail.id}/members/${userId}`, { method: "PATCH", body: { role: next } });
      toast("Role changed.");
      await onChanged();
    } catch (err) {
      toast(errorText(err));
      await onChanged();
    }
  };

  const remove = async (userId: string) => {
    try {
      await api(`/api/companies/${detail.id}/members/${userId}`, { method: "DELETE" });
      toast(userId === me.id ? "You left the company." : "Removed from the company and its projects.");
      await onChanged();
    } catch (err) {
      toast(errorText(err));
    }
  };

  const cancelInvite = async (id: string) => {
    try {
      await api(`/api/companies/${detail.id}/invitations/${id}`, { method: "DELETE" });
      await onChanged();
    } catch (err) {
      toast(errorText(err));
    }
  };

  return (
    <div className="grid gap-6">
      <form className="grid gap-3" onSubmit={invite}>
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">Invite people to the company</h3>
          <p className="text-sm text-muted-foreground">
            Members see every project that is not secret. To share one project only, invite the person from that project's People tab. They join as a guest.
          </p>
        </div>
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
          <NativeSelect aria-label="Company role" value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
            <NativeSelectOption value="member">Member</NativeSelectOption>
            <NativeSelectOption value="admin">Admin</NativeSelectOption>
          </NativeSelect>
          <Button type="submit" disabled={busy}>
            Invite
          </Button>
        </div>
      </form>
      <ul className="divide-y rounded-lg border" data-people="">
        {detail.members.map((m) => {
          const canEditRow = (isOwner || m.role !== "owner") && m.userId !== me.id;
          return (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <Avatar id={m.userId} name={m.name || m.email} size={32} />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-sm font-medium">{m.name || m.email}</span>
                <span className="truncate text-xs text-muted-foreground">{m.email}</span>
              </span>
              {canEditRow ? (
                <NativeSelect
                  size="sm"
                  aria-label={`Company role for ${m.name || m.email}`}
                  value={m.role}
                  onChange={(e) => changeRole(m.userId, e.target.value as CompanyRole)}
                >
                  {COMPANY_ROLES.filter((r) => isOwner || r !== "owner").map((r) => (
                    <NativeSelectOption key={r} value={r}>
                      {COMPANY_ROLE_LABELS[r]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : (
                <Badge variant="secondary">{COMPANY_ROLE_LABELS[m.role]}</Badge>
              )}
              {(canEditRow || (m.userId === me.id && !(m.role === "owner" && ownerCount <= 1))) && (
                <ConfirmButton
                  label={m.userId === me.id ? "Leave" : "Remove"}
                  confirmLabel={m.userId === me.id ? "Click again to leave" : "Click again to remove"}
                  onConfirm={() => remove(m.userId)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {detail.invitations.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">Waiting to sign in</h3>
          <ul className="divide-y rounded-lg border">
            {detail.invitations.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate text-sm font-medium">{i.email}</span>
                  <span className="text-xs text-muted-foreground">Invited as {COMPANY_ROLE_LABELS[i.role].toLowerCase()}</span>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => cancelInvite(i.id)}>
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <RoleHelp items={COMPANY_ROLES.map((r) => [COMPANY_ROLE_LABELS[r], COMPANY_ROLE_HELP[r]])} />
    </div>
  );
}

/** A short list that says what each role can do. */
export function RoleHelp({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid gap-2 rounded-lg bg-muted/50 p-4 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
      {items.map(([name, help]) => (
        <div key={name} className="contents">
          <dt className="font-medium">{name}</dt>
          <dd className="mb-1 text-muted-foreground sm:mb-0">{help}</dd>
        </div>
      ))}
    </dl>
  );
}

const ROLE_ORDER: Role[] = ["owner", "editor", "viewer"];

function AiDefaultsTab({ detail, onChanged }: { detail: CompanyDetail; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [draft, setDraft] = useState<AiPolicy>(detail.aiDefaults);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/companies/${detail.id}`, { method: "PATCH", body: { aiDefaults: draft } });
      toast("AI defaults saved. New projects start with them.");
      await onChanged();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">
        New projects in this company start with these settings. Project owners can change them later. Existing projects keep their own settings.
      </p>
      <div className="divide-y rounded-lg border" data-policy="">
        {ROLE_ORDER.map((role) => (
          <div key={role} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="text-sm font-medium">{ROLE_LABELS[role]}s</span>
            <NativeSelect
              size="sm"
              aria-label={`Default agent level for ${ROLE_LABELS[role].toLowerCase()}s`}
              value={draft[role]}
              onChange={(e) => setDraft((d) => ({ ...d, [role]: e.target.value as AgentLevel }))}
            >
              {AGENT_LEVELS.filter((l) => levelRank(l) <= levelRank(ROLE_CEILING[role])).map((l) => (
                <NativeSelectOption key={l} value={l}>
                  {AGENT_LEVEL_LABELS[l]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="text-sm font-medium">Topic scope</span>
          <NativeSelect
            size="sm"
            aria-label="Default topic scope"
            value={draft.scope}
            onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value as AgentScope }))}
          >
            {AGENT_SCOPES.map((sc) => (
              <NativeSelectOption key={sc} value={sc}>
                {AGENT_SCOPE_LABELS[sc]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="cs-notes" checked={draft.readNotes} onCheckedChange={(v) => setDraft((d) => ({ ...d, readNotes: v }))} />
        <Label htmlFor="cs-notes">Let the agent search task notes</Label>
      </div>
      <div className="flex justify-end">
        <Button type="button" disabled={busy} onClick={save}>
          Save AI defaults
        </Button>
      </div>
    </div>
  );
}
