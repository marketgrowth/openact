import { useCallback, useEffect, useRef, useState } from "react";
import { WORKSPACE_KINDS, WORKSPACE_KIND_LABELS, isHexColor, type Company, type Workspace, type WorkspaceKind } from "@openact/core/shared";
import { api, errorText } from "../api";
import { Field, Modal, Notice, useToast } from "../ui";
import { useWorkspace } from "../workspace";
import { CompanyMark } from "./Sidebar";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Badge } from "@openact/ui/components/badge";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";

/*
 * Company settings, Workspaces section. Owners and admins add, rename and archive workspaces,
 * and set each one's kind, logo, colors and website. The default workspace cannot be archived.
 */

function KindSelect({ id, value, onChange }: { id: string; value: WorkspaceKind; onChange: (k: WorkspaceKind) => void }) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value as WorkspaceKind)}>
      {WORKSPACE_KINDS.map((k) => (
        <NativeSelectOption key={k} value={k}>
          {WORKSPACE_KIND_LABELS[k]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

export function WorkspacesTab({ company }: { company: Pick<Company, "id" | "name" | "logoUrl"> }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [list, setList] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WorkspaceKind>("brand");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Workspace | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ workspaces: Workspace[] }>(`/api/companies/${company.id}/workspaces?archived=1`);
      setList(r.workspaces);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [company.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Loads the list here and in the switcher. */
  const changed = async () => {
    await Promise.all([load(), ws.reloadCompanies()]);
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ workspace: Workspace }>(`/api/companies/${company.id}/workspaces`, { body: { name, kind } });
      toast(`Added "${r.workspace.name}". Switch to it from the company menu.`);
      setName("");
      await changed();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!list) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const active = list.filter((w) => !w.archived);
  const archived = list.filter((w) => w.archived);

  return (
    <div className="grid gap-6" data-workspaces="">
      {active.length === 1 && (
        <Notice tone="info">
          This company has one workspace, so nobody sees a workspace switcher. Add a second workspace when the same team works on more than one brand,
          business unit, location or region. Use a separate company when the people, billing or legal entity are different.
        </Notice>
      )}
      <form className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end" onSubmit={add}>
        <Field label="New workspace" htmlFor="ws-new-name">
          <Input id="ws-new-name" required maxLength={80} placeholder="Brand X" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Kind" htmlFor="ws-new-kind">
          <KindSelect id="ws-new-kind" value={kind} onChange={setKind} />
        </Field>
        <Button type="submit" disabled={busy || !name.trim()}>
          Add workspace
        </Button>
      </form>

      <WorkspaceList company={company} items={active} onEdit={setEditing} />
      {archived.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">Archived</h3>
          <p className="text-sm text-muted-foreground">Archived workspaces keep their projects and docs. Owners and admins still see that work in All workspaces.</p>
          <WorkspaceList company={company} items={archived} onEdit={setEditing} />
        </div>
      )}
      {editing && (
        <WorkspaceDialog
          company={company}
          workspace={editing}
          onClose={() => setEditing(null)}
          onSaved={async (w) => {
            setEditing(w);
            await changed();
          }}
        />
      )}
    </div>
  );
}

function WorkspaceList({ company, items, onEdit }: { company: Pick<Company, "logoUrl">; items: Workspace[]; onEdit: (w: Workspace) => void }) {
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((w) => (
        <li key={w.id} className="flex items-center gap-3 px-3 py-2" data-workspace-row={w.slug}>
          <CompanyMark company={{ id: w.id, name: w.name, logoUrl: w.logoUrl ?? company.logoUrl }} size={32} />
          <div className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-sm font-medium">{w.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {WORKSPACE_KIND_LABELS[w.kind]}
              {w.website ? ` · ${w.website.replace(/^https?:\/\//, "")}` : ""}
            </span>
          </div>
          {w.isDefault && <Badge variant="secondary">Default</Badge>}
          {w.archived && <Badge variant="outline">Archived</Badge>}
          <Button type="button" variant="outline" size="sm" onClick={() => onEdit(w)}>
            Edit
          </Button>
        </li>
      ))}
    </ul>
  );
}

function WorkspaceDialog({
  company,
  workspace,
  onClose,
  onSaved
}: {
  company: Pick<Company, "id" | "logoUrl">;
  workspace: Workspace;
  onClose: () => void;
  onSaved: (w: Workspace) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(workspace.name);
  const [kind, setKind] = useState<WorkspaceKind>(workspace.kind);
  const [slug, setSlug] = useState(workspace.slug);
  const [website, setWebsite] = useState(workspace.website ?? "");
  const [primary, setPrimary] = useState(workspace.colors.primary ?? "");
  const [accent, setAccent] = useState(workspace.colors.accent ?? "");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const base = `/api/companies/${company.id}/workspaces/${workspace.id}`;
  const badColor = [primary, accent].some((c) => c.trim() && !isHexColor(c.trim()));

  const run = async (fn: () => Promise<{ workspace: Workspace }>, done: string) => {
    setBusy(true);
    try {
      const r = await fn();
      toast(done);
      await onSaved(r.workspace);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void run(
      () =>
        api(base, {
          method: "PATCH",
          body: { name, kind, slug, website: website.trim() || null, colors: { primary: primary.trim() || null, accent: accent.trim() || null } }
        }),
      "Workspace saved."
    );
  };

  const upload = (f: File | undefined) => {
    if (!f) return;
    const form = new FormData();
    form.append("file", f);
    void run(() => api(`${base}/logo`, { method: "PUT", form }), "Logo saved.").finally(() => {
      if (file.current) file.current.value = "";
    });
  };

  return (
    <Modal title={`Edit ${workspace.name}`} description="The kind changes only the label. Every kind works the same way." onClose={onClose} wide>
      <form className="grid gap-5" onSubmit={save}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="ws-name">
            <Input id="ws-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Kind" htmlFor="ws-kind">
            <KindSelect id="ws-kind" value={kind} onChange={setKind} />
          </Field>
          <Field label="Slug" htmlFor="ws-slug" help="Lowercase letters, numbers and dashes. Unique in the company.">
            <Input id="ws-slug" required maxLength={40} value={slug} onChange={(e) => setSlug(e.target.value)} />
          </Field>
          <Field label="Website" htmlFor="ws-web">
            <Input id="ws-web" maxLength={253} placeholder="https://example.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </Field>
          <Field label="Primary color" htmlFor="ws-primary" help="A hex color code from the brand guide: # and 3 or 6 letters or digits.">
            <ColorInput id="ws-primary" value={primary} onChange={setPrimary} />
          </Field>
          <Field label="Accent color" htmlFor="ws-accent" help="A hex color code: # and 3 or 6 letters or digits.">
            <ColorInput id="ws-accent" value={accent} onChange={setAccent} />
          </Field>
        </div>
        <Field label="Logo" help="PNG, JPEG or WebP, up to 1 MB. Without a logo, the company logo shows.">
          <div className="flex flex-wrap items-center gap-3">
            <CompanyMark company={{ id: workspace.id, name: workspace.name, logoUrl: workspace.logoUrl ?? company.logoUrl }} size={48} />
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id="ws-logo" onChange={(e) => upload(e.target.files?.[0])} />
            <Button asChild variant="outline" size="sm">
              <label htmlFor="ws-logo" className="cursor-pointer">
                {workspace.logoUrl ? "Replace logo" : "Upload logo"}
              </label>
            </Button>
            {workspace.logoUrl && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => api(`${base}/logo`, { method: "DELETE" }), "Logo removed.")}>
                Remove
              </Button>
            )}
          </div>
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {workspace.isDefault ? (
            <p className="text-sm text-muted-foreground">This is the default workspace. It cannot be archived.</p>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(
                  () => api(base, { method: "PATCH", body: { archived: !workspace.archived } }),
                  workspace.archived ? "Workspace restored." : "Workspace archived. Its work stays in All workspaces."
                )
              }
            >
              {workspace.archived ? "Restore workspace" : "Archive workspace"}
            </Button>
          )}
          <Button type="submit" disabled={busy || !name.trim() || badColor}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** A hex color field with a swatch. The swatch shows the brand's own color, which is data, not a theme color. */
function ColorInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const ok = isHexColor(value.trim());
  return (
    <div className="flex items-center gap-2">
      <span className="size-8 shrink-0 rounded-md border bg-muted" style={ok ? { backgroundColor: value.trim() } : undefined} aria-hidden="true" />
      <Input id={id} maxLength={7} value={value} aria-invalid={value.trim() !== "" && !ok} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
