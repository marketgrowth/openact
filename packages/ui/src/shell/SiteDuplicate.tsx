import { useEffect, useState } from "react";
import type { DuplicateCompanyResult, SiteCompanies, SiteCompanyApps as Company } from "@openact/core/shared";
import { api, errorText } from "../api";
import { navigate } from "../router";
import { Field, Modal, Notice, useToast } from "../ui";
import { useWorkspace } from "../workspace";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";

/*
 * Site settings > Duplicate a company. A super admin makes a new company with a copy of another company's content,
 * such as its projects and docs. The super admin is the only owner of the copy.
 */
export function SiteDuplicate() {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SiteCompanies | null>(null);
  const [source, setSource] = useState<Company | null>(null);

  useEffect(() => {
    const q = query.trim();
    const timer = setTimeout(
      () => {
        api<SiteCompanies>(`/api/site/companies${q.length >= 2 ? `?q=${encodeURIComponent(q)}` : ""}`)
          .then(setData)
          .catch((err) => toast(errorText(err)));
      },
      q ? 250 : 0
    );
    return () => clearTimeout(timer);
  }, [query, toast]);

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const searching = query.trim().length >= 2;
  const more = !searching && data.total > data.companies.length;

  return (
    <div className="grid gap-6">
      <div className="grid gap-2 text-sm text-muted-foreground">
        <p>The copy gets the company's projects with their columns, tasks and task files, and the Docs library with its folders, categories, tags, docs, images and PDFs. It also gets the logo, the app settings and the permissions.</p>
        <p>The copy does not get people, invitations, the plan, the AI provider key, the email domain, task assignees, comments, share links or AI agent history. You are its only owner. Invite people to it after the copy is made.</p>
      </div>
      <Field label="Find a company" htmlFor="site-duplicate-search" help="Type 2 or more letters of a company name.">
        <div className="grid gap-3" data-site-duplicate="">
          <Input id="site-duplicate-search" type="search" value={query} placeholder="Find a company by name" onChange={(e) => setQuery(e.target.value)} />
          {!data.companies.length ? (
            <p className="text-sm text-muted-foreground">{searching ? "No company on this site matches." : "This site has no companies yet."}</p>
          ) : (
            <ul className="grid gap-2">
              {data.companies.map((co) => (
                <li key={co.id} className="flex items-center gap-3 rounded-lg border p-3" data-site-duplicate-company={co.id}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{co.name}</p>
                    <p className="text-xs text-muted-foreground">{`${co.members} ${co.members === 1 ? "person" : "people"}`}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSource(co)}>
                    Duplicate
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {more && <p className="text-xs text-muted-foreground">{`Showing ${data.companies.length} of ${data.total} companies. Search to find the others.`}</p>}
        </div>
      </Field>
      {source && <DuplicateDialog source={source} onClose={() => setSource(null)} />}
    </div>
  );
}

function DuplicateDialog({ source, onClose }: { source: Company; onClose: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [name, setName] = useState(`${source.name} (copy)`.slice(0, 80));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DuplicateCompanyResult | null>(null);

  const duplicate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<DuplicateCompanyResult>(`/api/site/companies/${encodeURIComponent(source.id)}/duplicate`, { body: { name } });
      await ws.reloadCompanies();
      setDone(r);
      toast(`Made "${r.company.name}".`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    if (!done) return;
    await ws.switchTo(done.company.id);
    navigate("/");
  };

  if (done)
    return (
      <Modal title="The copy is ready" description={`"${done.company.name}" is a new company. You are its only owner.`} onClose={onClose}>
        <ul className="grid gap-1 text-sm" data-duplicate-summary="">
          {done.copied.map((c) => (
            <li key={c.label} className="flex justify-between gap-3">
              <span>{c.label}</span>
              <span className="tabular-nums text-muted-foreground">{c.count}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Done
          </Button>
          <Button type="button" onClick={open}>
            Open the company
          </Button>
        </div>
      </Modal>
    );

  return (
    <Modal title={`Duplicate ${source.name}`} description="Make a new company with a copy of this company's content. The original does not change." onClose={busy ? () => undefined : onClose}>
      <form className="grid gap-4" onSubmit={duplicate}>
        <Field label="Name of the new company" htmlFor="dup-name">
          <Input id="dup-name" required maxLength={80} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </Field>
        {busy && <Notice tone="info">Copying. A company with many files can take a minute. Keep this page open.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Duplicating…" : "Duplicate company"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
