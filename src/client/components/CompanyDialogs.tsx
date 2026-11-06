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
import { Avatar, ConfirmButton, Modal, useToast } from "../ui";
import { useWorkspace } from "../workspace";
import { CompanyMark } from "./Sidebar";

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
    <Modal title="Create a company" onClose={onClose}>
      <form className="stack" onSubmit={create}>
        <p className="muted">A company holds projects and people. You are its owner. You can invite people and add a logo next.</p>
        <div className="field">
          <label htmlFor="nc-name">Company name</label>
          <input id="nc-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Acme Studio" />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row-end">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            Create company
          </button>
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
      {error && <div className="notice warn">{error}</div>}
      {!detail && !error && <p className="muted">Loading…</p>}
      {detail && (
        <div className="stack">
          <div className="co-settings-head">
            <CompanyMark company={detail} size={40} />
            <div>
              <b>{detail.name}</b>
              <p className="hint">You are {detail.role === "admin" ? "an admin" : "the owner"} of this company.</p>
            </div>
          </div>
          <div className="seg" role="tablist" aria-label="Company settings">
            {(
              [
                ["general", "General"],
                ["people", `People (${detail.members.length})`],
                ["ai", "AI defaults"]
              ] as Array<[Tab, string]>
            ).map(([id, text]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                {text}
              </button>
            ))}
          </div>
          {tab === "general" && <GeneralTab detail={detail} me={me} onChanged={changed} onDeleted={onClose} />}
          {tab === "people" && <PeopleTab detail={detail} me={me} onChanged={changed} />}
          {tab === "ai" && <AiDefaultsTab detail={detail} onChanged={changed} />}
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
    <div className="stack">
      <form className="stack" onSubmit={save}>
        <div className="field">
          <label htmlFor="cs-name">Company name</label>
          <input id="cs-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <span className="lbl">Logo</span>
          <div className="logo-row">
            <CompanyMark company={detail} size={48} />
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id="cs-logo" onChange={(e) => upload(e.target.files?.[0])} />
            <label htmlFor="cs-logo" className="btn">
              {detail.logoUrl ? "Replace logo" : "Upload logo"}
            </label>
            {detail.logoUrl && (
              <button type="button" className="btn ghost" onClick={removeLogo}>
                Remove
              </button>
            )}
          </div>
          <p className="hint">PNG, JPEG or WebP, up to 1 MB. A square image looks best.</p>
        </div>
        <div className="field">
          <label htmlFor="cs-domain">Email domain for auto-join</label>
          <input id="cs-domain" value={domain} maxLength={253} placeholder={myDomain || "example.com"} onChange={(e) => setDomain(e.target.value)} />
          <p className="hint">
            People who sign in with an email at this domain join the company as members. Leave it empty to turn this off. Your own email must use the domain, and public
            domains such as gmail.com do not work.
          </p>
        </div>
        <div className="row-end">
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            Save
          </button>
        </div>
      </form>
      {detail.role === "owner" && (
        <>
          <hr />
          <div className="stack">
            <div className="row-wrap">
              <ConfirmButton label="Delete company" confirmLabel="Click again to delete the company and all its projects" onConfirm={remove} />
            </div>
            <p className="hint">Deleting a company removes all its projects, tasks and files for everyone. You cannot undo it.</p>
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
    <div className="stack">
      <form className="invite" onSubmit={invite}>
        <h3 className="sub-h">Invite people to the company</h3>
        <p className="hint">Members see every project that is not secret. To share one project only, invite the person from that project's People tab. They join as a guest.</p>
        <div className="invite-row">
          <input type="email" required placeholder="name@company.com" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select aria-label="Company role" value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" className="btn primary" disabled={busy}>
            Invite
          </button>
        </div>
      </form>
      <ul className="people">
        {detail.members.map((m) => {
          const canEditRow = (isOwner || m.role !== "owner") && m.userId !== me.id;
          return (
            <li key={m.userId}>
              <Avatar id={m.userId} name={m.name || m.email} size={30} />
              <span className="who">
                <b>{m.name || m.email}</b>
                <span className="hint">{m.email}</span>
              </span>
              {canEditRow ? (
                <select aria-label={`Company role for ${m.name || m.email}`} value={m.role} onChange={(e) => changeRole(m.userId, e.target.value as CompanyRole)}>
                  {COMPANY_ROLES.filter((r) => isOwner || r !== "owner").map((r) => (
                    <option key={r} value={r}>
                      {COMPANY_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="chip">{COMPANY_ROLE_LABELS[m.role]}</span>
              )}
              {(canEditRow || (m.userId === me.id && !(m.role === "owner" && ownerCount <= 1))) && (
                <ConfirmButton
                  className="ghost sm"
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
        <div>
          <h3 className="sub-h">Waiting to sign in</h3>
          <ul className="people">
            {detail.invitations.map((i) => (
              <li key={i.id}>
                <span className="who">
                  <b>{i.email}</b>
                  <span className="hint">Invited as {COMPANY_ROLE_LABELS[i.role].toLowerCase()}</span>
                </span>
                <button type="button" className="btn ghost sm" onClick={() => cancelInvite(i.id)}>
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="role-help">
        {COMPANY_ROLES.map((r) => (
          <div key={r}>
            <dt>{COMPANY_ROLE_LABELS[r]}</dt>
            <dd>{COMPANY_ROLE_HELP[r]}</dd>
          </div>
        ))}
      </dl>
    </div>
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
    <div className="stack">
      <p className="hint">New projects in this company start with these settings. Project owners can change them later. Existing projects keep their own settings.</p>
      <div className="policy">
        {ROLE_ORDER.map((role) => (
          <div key={role} className="policy-row">
            <span className="policy-role">{ROLE_LABELS[role]}s</span>
            <select aria-label={`Default agent level for ${ROLE_LABELS[role].toLowerCase()}s`} value={draft[role]} onChange={(e) => setDraft((d) => ({ ...d, [role]: e.target.value as AgentLevel }))}>
              {AGENT_LEVELS.filter((l) => levelRank(l) <= levelRank(ROLE_CEILING[role])).map((l) => (
                <option key={l} value={l}>
                  {AGENT_LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div className="policy-row">
          <span className="policy-role">Topic scope</span>
          <select aria-label="Default topic scope" value={draft.scope} onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value as AgentScope }))}>
            {AGENT_SCOPES.map((sc) => (
              <option key={sc} value={sc}>
                {AGENT_SCOPE_LABELS[sc]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="toggle policy-toggle">
        <input type="checkbox" checked={draft.readNotes} onChange={(e) => setDraft((d) => ({ ...d, readNotes: e.target.checked }))} />
        Let the agent search task notes
      </label>
      <div className="row-end">
        <button type="button" className="btn primary" disabled={busy} onClick={save}>
          Save AI defaults
        </button>
      </div>
    </div>
  );
}
