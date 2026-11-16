import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, errorText, fmtDateTime, Icon, navigate, Notice, PageBody, SiteHeader, useLive, useToast } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@openact/ui/components/dropdown-menu";
import { TITLE_MAX, fmtBytes, type DocDetail, type PdfFile } from "../shared/types";
import { DeleteDialog, ShareDialog } from "./dialogs";
import { MetaBar, Trail } from "./doc-parts";
import { pdfFileProblem } from "./library-dialogs";
import { DOCS_HOME } from "./state";

/*
 * An uploaded PDF: the browser's own PDF viewer in a frame, with the PDF's title, folder, category and tags.
 * Editors can replace the file. Docs keeps only the latest file, so a replace deletes the old one.
 */

const POLL_MS = 15000;

export function PdfPage({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<DocDetail>(`/api/apps/docs/docs/${docId}`);
      // A doc written in the editor has its own page.
      if (d.kind !== "pdf") return navigate(`${DOCS_HOME}/d/${docId}`, true);
      setDoc(d);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [docId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error || !doc)
    return (
      <>
        <SiteHeader title="PDF" />
        <PageBody>{error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-muted-foreground">Loading the PDF…</p>}</PageBody>
      </>
    );
  return <LoadedPdf initial={doc} />;
}

function LoadedPdf({ initial }: { initial: DocDetail }) {
  const toast = useToast();
  const id = initial.id;
  const [title, setTitle] = useState(initial.title);
  const [file, setFile] = useState<PdfFile | null>(initial.pdf);
  const [shareUrl, setShareUrl] = useState(initial.shareUrl);
  const [shared, setShared] = useState(initial.shared);
  const [updated, setUpdated] = useState({ at: initial.updatedAt, by: initial.updatedByName });
  const [gone, setGone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | "share" | "delete">(null);
  const rev = useRef(initial.rev);
  const savedTitle = useRef(initial.title);
  const input = useRef<HTMLInputElement>(null);
  const canEdit = initial.canEdit && !gone;

  // Someone else replaced the file or renamed the PDF: show their version.
  const refresh = useCallback(async () => {
    try {
      const d = await api<DocDetail>(`/api/apps/docs/docs/${id}`);
      rev.current = d.rev;
      setFile(d.pdf);
      setShared(d.shared);
      setShareUrl(d.shareUrl);
      setUpdated({ at: d.updatedAt, by: d.updatedByName });
      if (d.title !== savedTitle.current && !document.activeElement?.hasAttribute("data-doc-title")) {
        savedTitle.current = d.title;
        setTitle(d.title);
      }
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) setGone(e.message);
    }
  }, [id]);

  const onRev = useCallback(
    (r: number) => {
      if (r === 0) return setGone("Someone deleted this PDF.");
      if (r !== rev.current) void refresh();
    },
    [refresh]
  );
  const live = useLive(`/api/apps/docs/docs/${encodeURIComponent(id)}/live`, !gone, onRev);

  // Without live updates, check the rev now and then.
  useEffect(() => {
    if (live.connected || gone) return;
    const t = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        onRev((await api<{ rev: number }>(`/api/apps/docs/docs/${id}/rev`)).rev);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) onRev(0);
      }
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [live.connected, gone, id, onRev]);

  const saveTitle = async () => {
    const next = title.trim();
    if (next === savedTitle.current) return;
    try {
      await api(`/api/apps/docs/docs/${id}`, { method: "PATCH", body: { title: next } });
      savedTitle.current = next || "Untitled PDF";
      setTitle(savedTitle.current);
      toast("The title is saved.");
    } catch (e) {
      toast(errorText(e));
    }
  };

  const replace = async (f: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!f) return;
    const problem = pdfFileProblem(f);
    if (problem) return toast(problem);
    setBusy(true);
    toast(`Uploading ${f.name}…`);
    try {
      const form = new FormData();
      form.append("file", f);
      const r = await api<{ rev: number; pdf: PdfFile }>(`/api/apps/docs/docs/${id}/pdf`, { method: "POST", form });
      rev.current = r.rev;
      setFile(r.pdf);
      setUpdated({ at: r.pdf.uploadedAt, by: null });
      toast("The new file is uploaded. The old file is deleted.");
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await api(`/api/apps/docs/docs/${id}`, { method: "DELETE" });
      toast("The PDF is deleted.");
      navigate(initial.folderId ? `${DOCS_HOME}/f/${initial.folderId}` : DOCS_HOME);
    } catch (e) {
      toast(errorText(e));
    }
  };

  const src = file ? `/api/apps/docs/docs/${id}/pdf?v=${encodeURIComponent(file.fileId)}` : null;

  return (
    <>
      <SiteHeader title={<Trail folderId={initial.folderId} />}>
        {src && (
          <>
            <Button asChild variant="outline" size="sm">
              <a href={`${src}&download=1`} data-pdf-download="">
                <Icon name="download" /> <span className="hidden sm:inline">Download</span>
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={src} target="_blank" rel="noreferrer" data-pdf-open="">
                <Icon name="external" /> <span className="hidden sm:inline">Open</span>
              </a>
            </Button>
          </>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()} data-pdf-replace="">
            <Icon name="upload" /> <span className="hidden sm:inline">Replace file</span>
          </Button>
        )}
        {initial.canShare ? (
          <Button size="sm" onClick={() => setDialog("share")} data-doc-share="">
            <Icon name="share" /> <span className="hidden sm:inline">{shared ? "Shared" : "Share"}</span>
          </Button>
        ) : (
          shared && <Badge variant="secondary">Shared with a link</Badge>
        )}
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="More PDF actions">
                <Icon name="dots" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDialog("delete")}>
                <Icon name="trash" /> Delete PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SiteHeader>
      <PageBody>
        <div className="grid min-w-0 gap-3" data-pdf-page={id}>
          <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void replace(e.target.files?.[0])} />
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">PDF</Badge>
            <input
              className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-xl font-semibold tracking-tight outline-none hover:border-input focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-100"
              value={title}
              maxLength={TITLE_MAX}
              disabled={!canEdit}
              aria-label="PDF title"
              placeholder="Untitled PDF"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              data-doc-title=""
            />
          </div>
          {file && (
            <p className="px-2 text-xs text-muted-foreground" data-pdf-file="">
              {file.name} · {fmtBytes(file.size)} · Updated {fmtDateTime(updated.at)}
              {updated.by ? ` by ${updated.by}` : ""}
            </p>
          )}
          <MetaBar doc={initial} canEdit={canEdit} noun="PDF" />

          {gone && <Notice tone="error">{gone}</Notice>}
          {!file && !gone && (
            <Notice tone="error">The file of this PDF is missing. {canEdit ? "Choose Replace file to upload it again." : "Ask an editor to upload it again."}</Notice>
          )}
          {src && !gone && (
            <iframe
              key={src}
              src={src}
              title={title || "PDF"}
              className="h-[calc(100dvh-16rem)] min-h-[32rem] w-full rounded-xl border bg-muted"
              data-pdf-frame=""
            />
          )}
          {src && !gone && (
            <p className="text-xs text-muted-foreground">If the PDF does not show here, choose Open or Download. Some phone browsers cannot show a PDF inside a page.</p>
          )}
        </div>

        {dialog === "share" && (
          <ShareDialog
            docId={id}
            url={shareUrl}
            pdf
            onChanged={(u) => {
              setShareUrl(u);
              setShared(!!u);
            }}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === "delete" && <DeleteDialog title={title || "Untitled PDF"} pdf onDelete={remove} onClose={() => setDialog(null)} />}
      </PageBody>
    </>
  );
}
