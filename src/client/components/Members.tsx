import { useState } from "react";
import { ROLES, ROLE_LABELS, type AccessRequest, type ProjectDetail, type Role, type User } from "../../shared/types";
import { api, errorText } from "../api";
import { navigate } from "../router";
import { Avatar, ConfirmButton, useToast } from "../ui";

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

  return (
    <div className="members">
      {isOwner && (
        <form className="invite" onSubmit={invite}>
          <h2>Invite people</h2>
          <p className="hint">There is no limit on people. Each person signs in with their email and a one-time code.</p>
          <div className="invite-row">
            <input type="email" required placeholder="name@company.com" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button type="submit" className="btn primary" disabled={busy || !email.trim()}>
              Send invitation
            </button>
          </div>
          <p className="hint">{ROLE_HELP[role]}</p>
        </form>
      )}

      {isOwner && data.accessRequests.length > 0 && (
        <section>
          <h2>
            Access requests <span className="count">{data.accessRequests.length}</span>
          </h2>
          <ul className="people">
            {data.accessRequests.map((r) => (
              <AccessRequestRow key={r.id} projectId={pid} request={r} onDone={onChanged} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>
          People <span className="count">{data.members.length}</span>
        </h2>
        <p className="hint">
          {data.project.visibility === "secret"
            ? "This project is secret. Only the people below can see it."
            : "Everyone in the company can also see this project as a viewer. Company owners and admins can manage it. Make the project secret in Project settings to limit it to the people below."}
        </p>
        <ul className="people">
          {data.members.map((m) => (
            <li key={m.userId}>
              <Avatar id={m.userId} name={m.name || m.email} size={34} />
              <span className="who">
                <b>
                  {m.name || m.email}
                  {m.userId === me.id && <span className="muted"> (you)</span>}
                </b>
                <span className="mono muted">{m.email}</span>
              </span>
              {isOwner ? (
                <select aria-label={`Role for ${m.name || m.email}`} value={m.role} onChange={(e) => changeRole(m.userId, e.target.value as Role)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="chip">{ROLE_LABELS[m.role]}</span>
              )}
              {(isOwner || m.userId === me.id) && (
                <ConfirmButton label={m.userId === me.id ? "Leave" : "Remove"} confirmLabel="Click to confirm" onConfirm={() => remove(m.userId)} className="sm" />
              )}
            </li>
          ))}
        </ul>
      </section>

      {isOwner && data.invitations.length > 0 && (
        <section>
          <h2>
            Waiting to join <span className="count">{data.invitations.length}</span>
          </h2>
          <ul className="people">
            {data.invitations.map((i) => (
              <li key={i.id}>
                <span className="av av-pending" aria-hidden="true">
                  @
                </span>
                <span className="who">
                  <b className="mono">{i.email}</b>
                  <span className="muted">Invited as {ROLE_LABELS[i.role].toLowerCase()}. They join the first time they sign in.</span>
                </span>
                <button type="button" className="btn ghost sm" onClick={() => revoke(i.id)}>
                  Cancel invitation
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
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
    <li>
      <Avatar id={request.userId} name={request.name || request.email} size={34} />
      <span className="who">
        <b>{request.name || request.email}</b>
        <span className="mono muted">{request.email}</span>
        {request.note && <span className="req-note">{request.note}</span>}
      </span>
      <select aria-label={`Role for ${request.name || request.email}`} value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={busy}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => answer(false)}>
        Decline
      </button>
      <button type="button" className="btn primary sm" disabled={busy} onClick={() => answer(true)}>
        Approve
      </button>
    </li>
  );
}
