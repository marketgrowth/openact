import { useCallback, useEffect, useState } from "react";
import { canManageCompany, type Company, type Workspace } from "@openact/core/shared";
import { api, errorText } from "../api";
import { Modal, Notice, useToast } from "../ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";

interface Person {
  id: string;
  name: string;
  email: string;
}
interface CompanyPerson extends Person {
  role: string;
}

/**
 * The people in a workspace. Owners and admins add and remove people.
 * Every person in the workspace can invite someone by email, unless the company turned that off for members.
 * Owners and admins are in every workspace, so the list does not show them.
 */
export function WorkspacePeople({ company, workspace, onClose }: { company: Pick<Company, "id" | "role">; workspace: Pick<Workspace, "id" | "name">; onClose: () => void }) {
  const toast = useToast();
  const manager = canManageCompany(company.role);
  const base = `/api/companies/${company.id}/workspaces/${workspace.id}`;
  const [people, setPeople] = useState<Person[] | null>(null);
  const [others, setOthers] = useState<Person[]>([]);
  const [pick, setPick] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ members: Person[] }>(`${base}/members`);
      setPeople(r.members);
      if (manager) {
        const d = await api<{ members: CompanyPerson[] }>(`/api/companies/${company.id}`);
        const inside = new Set(r.members.map((m) => m.id));
        setOthers(d.members.filter((m) => m.role === "member" && !inside.has(m.id)));
      }
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [base, company.id, manager]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
      await load();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api(`${base}/invite`, { body: { email } });
      setEmail("");
    }, "Done. A person who is new to the company gets an invitation. A person in the company joins now.");
  };

  return (
    <Modal title={`People in ${workspace.name}`} description="Owners and admins are in every workspace. Members see only the workspaces they are in." onClose={onClose} wide>
      <div className="grid gap-5" data-workspace-people-dialog="">
        {error && <Notice tone="error">{error}</Notice>}
        {!people && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {people && (
          <ul className="divide-y rounded-lg border">
            {people.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No members yet. Owners and admins can still open this workspace.</li>}
            {people.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate text-sm font-medium">{p.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{p.email}</span>
                </span>
                {manager && (
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => run(() => api(`${base}/members/${p.id}`, { method: "DELETE" }), "Removed from the workspace.")}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {manager && others.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="sm:flex-1">
              <NativeSelect aria-label="Add a company member" value={pick} onChange={(e) => setPick(e.target.value)}>
                <NativeSelectOption value="">Add a company member…</NativeSelectOption>
                {others.map((o) => (
                  <NativeSelectOption key={o.id} value={o.id}>
                    {o.name} ({o.email})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <Button
              type="button"
              disabled={busy || !pick}
              onClick={() =>
                run(async () => {
                  await api(`${base}/members`, { body: { userId: pick } });
                  setPick("");
                }, "Added to the workspace.")
              }
            >
              Add
            </Button>
          </div>
        )}
        <form className="grid gap-2" onSubmit={invite}>
          <h3 className="text-sm font-medium">Invite by email</h3>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input type="email" required placeholder="name@company.com" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} className="sm:flex-1" />
            <Button type="submit" disabled={busy}>
              Invite
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">The person joins this workspace as a member.</p>
        </form>
      </div>
    </Modal>
  );
}
