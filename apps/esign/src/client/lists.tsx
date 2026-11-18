import { useState } from "react";
import { api, errorText, fmtDateTime, Icon, Link, Modal, navigate, Notice, PageBody, SiteHeader, useToast, useWorkspace } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent } from "@openact/ui/components/card";
import { Input } from "@openact/ui/components/input";
import { Tabs, TabsList, TabsTrigger } from "@openact/ui/components/tabs";
import { API, ESIGN_HOME, LIMITS, PDF_MAX_LABEL, fmtBytes, type SubmissionStatus, type SubmissionSummary, type TemplateSummary } from "../shared/types";
import { Empty, RoleDot, SignerBadge, StatusBadge } from "./bits";
import { roleColor, useEsign, useLoad } from "./state";

/*
 * The eSign lists:
 *   /a/esign             documents sent for signature, by status
 *   /a/esign/templates   templates, and archived templates
 * and the New document dialog.
 */

type Filter = "pending" | "completed" | "closed" | "all";

export function DocumentsPage() {
  const { companyId, home, error: homeError, rev } = useEsign();
  const [filter, setFilter] = useState<Filter>("pending");
  const [mine, setMine] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const status = filter === "pending" || filter === "completed" ? `status=${filter}` : "";
  const url = companyId ? `${API}/companies/${companyId}/submissions?${status}${mine ? "&mine=1" : ""}` : null;
  const { data, error } = useLoad<{ submissions: SubmissionSummary[]; manage: boolean }>(url, rev);
  const list = (data?.submissions ?? []).filter((s) => filter !== "closed" || s.status === "declined" || s.status === "voided");

  return (
    <>
      <SiteHeader title="Documents">
        <Button size="sm" onClick={() => setNewOpen(true)} data-esign-new="">
          <Icon name="plus" /> New document
        </Button>
      </SiteHeader>
      <PageBody>
        {(homeError || error) && <Notice tone="error">{homeError || error}</Notice>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="pending">Waiting{home ? ` (${home.counts.pending})` : ""}</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
              <TabsTrigger value="closed">Declined or voided</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
          {data?.manage && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="size-4 accent-primary" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only documents I sent
            </label>
          )}
        </div>
        {data && !list.length && (
          <Empty
            title={filter === "pending" ? "Nothing is waiting for signatures" : "No documents here"}
            action={
              <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
                <Icon name="plus" /> New document
              </Button>
            }
          >
            Upload a PDF, add the fields that people fill in, and send it. Signers get a link by email and need no account.
          </Empty>
        )}
        {!data && !error && <p className="text-sm text-muted-foreground">Loading the documents…</p>}
        <ul className="grid gap-2" data-esign-documents="">
          {list.map((s) => (
            <li key={s.id}>
              <Link to={`${ESIGN_HOME}/s/${s.id}`} className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <Card className="gap-0 py-3 transition-colors hover:bg-accent/40">
                  <CardContent className="grid gap-2 px-4 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="grid min-w-0 gap-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon name="file-pen" className="shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{s.name}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        {s.signers.map((x) => (
                          <span key={x.id} className="flex items-center gap-1.5">
                            {x.name} <SignerBadge status={x.status} />
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground sm:justify-end">
                      <span className="tabular">{fmtDateTime(s.completedAt ?? s.createdAt)}</span>
                      <StatusBadge status={s.status as SubmissionStatus} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </PageBody>
      {newOpen && <NewDocumentDialog onClose={() => setNewOpen(false)} />}
    </>
  );
}

export function TemplatesPage() {
  const { companyId, rev } = useEsign();
  const [archived, setArchived] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const { data, error } = useLoad<{ templates: TemplateSummary[] }>(
    companyId ? `${API}/companies/${companyId}/templates${archived ? "?archived=1" : ""}` : null,
    rev
  );

  return (
    <>
      <SiteHeader title="Templates">
        <Button size="sm" onClick={() => setNewOpen(true)} data-esign-new-template="">
          <Icon name="plus" /> New template
        </Button>
      </SiteHeader>
      <PageBody>
        {error && <Notice tone="error">{error}</Notice>}
        <Tabs value={archived ? "archived" : "active"} onValueChange={(v) => setArchived(v === "archived")}>
          <TabsList>
            <TabsTrigger value="active">Templates</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>
        {data && !data.templates.length && (
          <Empty title={archived ? "No archived templates" : "No templates yet"}>
            {archived
              ? "Archived templates show here. Documents sent from them keep working."
              : "A template is a PDF with signer roles and fields. Make it once, then send it many times."}
          </Empty>
        )}
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-esign-templates="">
          {data?.templates.map((t) => (
            <li key={t.id}>
              <Link to={`${ESIGN_HOME}/t/${t.id}`} className="block h-full rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <Card className="h-full gap-0 py-4 transition-colors hover:bg-accent/40">
                  <CardContent className="grid gap-2 px-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon name="template" className="shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{t.name}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      {t.roles.map((r, i) => (
                        <span key={r.id} className="flex items-center gap-1.5">
                          <RoleDot color={roleColor(i)} /> {r.name}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t.pageCount} {t.pageCount === 1 ? "page" : "pages"} · {t.fieldCount} {t.fieldCount === 1 ? "field" : "fields"} · sent {t.sentCount}{" "}
                      {t.sentCount === 1 ? "time" : "times"}
                      {t.fromDocs ? " · from Docs" : ""}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </PageBody>
      {newOpen && <NewDocumentDialog onClose={() => setNewOpen(false)} startWith="upload" />}
    </>
  );
}

type Source = "template" | "upload" | "docs";

export function pdfFileProblem(f: File): string | null {
  if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") return `${f.name} is not a PDF. Choose a PDF file.`;
  if (f.size === 0) return `${f.name} is empty.`;
  if (f.size > LIMITS.pdfBytes) return `${f.name} is too large. The limit is ${PDF_MAX_LABEL}.`;
  return null;
}

/** New document: use a template, upload a PDF, or pick a PDF from Docs. A new PDF opens the template editor. */
export function NewDocumentDialog({ onClose, startWith }: { onClose: () => void; startWith?: Source }) {
  const { current } = useWorkspace();
  const { home, companyId } = useEsign();
  const toast = useToast();
  const [source, setSource] = useState<Source>(startWith ?? "template");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cid = companyId ?? current?.id ?? null;
  const templates = useLoad<{ templates: TemplateSummary[] }>(source === "template" && cid ? `${API}/companies/${cid}/templates` : null);
  const docs = useLoad<{ pdfs: Array<{ id: string; title: string; name: string; size: number; folder: string | null }> }>(
    source === "docs" && cid ? `${API}/companies/${cid}/docs-pdfs?q=${encodeURIComponent(q)}` : null
  );
  if (!cid) return null;

  const upload = async () => {
    if (!file) return;
    const p = pdfFileProblem(file);
    if (p) return setProblem(p);
    setBusy(true);
    setProblem(null);
    const form = new FormData();
    form.append("file", file);
    if (name.trim()) form.append("name", name.trim());
    try {
      const { id } = await api<{ id: string }>(`${API}/companies/${cid}/templates`, { method: "POST", form });
      onClose();
      toast("Your PDF is ready. Add the fields, then send it.");
      navigate(`${ESIGN_HOME}/t/${id}`);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const fromDocs = async (docId: string) => {
    setBusy(true);
    setProblem(null);
    try {
      const { id } = await api<{ id: string }>(`${API}/companies/${cid}/templates/from-docs`, { method: "POST", body: { docId } });
      onClose();
      navigate(`${ESIGN_HOME}/t/${id}`);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New document" description="Start from a template, or from a PDF. You add the fields before you send." onClose={onClose} wide>
      <Tabs value={source} onValueChange={(v) => setSource(v as Source)}>
        <TabsList>
          <TabsTrigger value="template">Use a template</TabsTrigger>
          <TabsTrigger value="upload">Upload a PDF</TabsTrigger>
          {home?.docs.on && <TabsTrigger value="docs">From Docs</TabsTrigger>}
        </TabsList>
      </Tabs>
      {problem && <Notice tone="error">{problem}</Notice>}

      {source === "template" && (
        <div className="grid gap-2" data-esign-pick-template="">
          {templates.error && <Notice tone="error">{templates.error}</Notice>}
          {templates.data && !templates.data.templates.length && (
            <p className="text-sm text-muted-foreground">There are no templates yet. Upload a PDF to make one.</p>
          )}
          <ul className="grid max-h-80 gap-1 overflow-y-auto">
            {templates.data?.templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => {
                    onClose();
                    navigate(`${ESIGN_HOME}/t/${t.id}/send`);
                  }}
                >
                  <Icon name="template" className="shrink-0 text-muted-foreground" />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">{t.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{t.roles.map((r) => r.name).join(", ")}</span>
                  </span>
                  <Icon name="right" className="text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {source === "upload" && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void upload();
          }}
        >
          <label
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center hover:bg-accent/40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
          >
            <Icon name="upload" size={20} className="text-muted-foreground" />
            <span className="text-sm">{file ? `${file.name} (${fmtBytes(file.size)})` : "Choose a PDF, or drop it here"}</span>
            <span className="text-xs text-muted-foreground">Up to {PDF_MAX_LABEL}. A PDF with a password does not work.</span>
            <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-esign-file="" />
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional), such as Mutual NDA"
            maxLength={LIMITS.name}
            aria-label="Name"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!file || busy} data-esign-upload="">
              {busy ? "Uploading…" : "Upload and add fields"}
            </Button>
          </div>
        </form>
      )}

      {source === "docs" && (
        <div className="grid gap-2" data-esign-pick-docs="">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a PDF in Docs by title" aria-label="Find a PDF in Docs" />
          {docs.error && <Notice tone="error">{docs.error}</Notice>}
          {docs.data && !docs.data.pdfs.length && (
            <p className="text-sm text-muted-foreground">No PDFs in Docs match. Upload PDFs in Docs, or upload one here.</p>
          )}
          <ul className="grid max-h-80 gap-1 overflow-y-auto">
            {docs.data?.pdfs.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  disabled={busy}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
                  onClick={() => void fromDocs(d.id)}
                >
                  <Icon name="pdf" className="shrink-0 text-muted-foreground" />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">{d.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {d.folder ? `${d.folder} · ` : ""}
                      {fmtBytes(d.size)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
