import { useState } from "react";
import { api, errorText, fmtDateTime, Icon, Link, Modal, navigate, Notice, PageBody, SiteHeader, useToast } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openact/ui/components/card";
import { Input } from "@openact/ui/components/input";
import { API, ESIGN_HOME, fmtBytes, type Submission } from "../shared/types";
import { SignerBadge, StatusBadge, responseError, saveBlob } from "./bits";
import { useEsign, useLoad } from "./state";

/*
 * One document sent for signature: who signed, what happened when, and the actions:
 * remind, void, download the signed PDF, and check a copy of the signed PDF by its SHA-256 hash.
 */

const EVENT_LABELS: Record<string, string> = {
  created: "Created",
  sent: "Sent",
  opened: "Opened",
  consented: "Agreed to sign electronically",
  signed: "Signed",
  declined: "Declined",
  reminded: "Reminder sent",
  completed: "Completed",
  voided: "Voided"
};

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function SubmissionPage({ submissionId }: { submissionId: string }) {
  const { rev } = useEsign();
  const toast = useToast();
  const { data: s, error, reload } = useLoad<Submission>(`${API}/submissions/${submissionId}`, rev);
  const [dialog, setDialog] = useState<null | "void" | "delete">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<null | { name: string; match: boolean }>(null);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
      await reload();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const download = async (what: "signed" | "file") => {
    const res = await fetch(`${API}/submissions/${submissionId}/${what}?download=1`, { credentials: "same-origin" });
    if (!res.ok) return toast(await responseError(res));
    await saveBlob(res, `${s?.name ?? "document"}.pdf`);
  };

  if (!s)
    return (
      <>
        <SiteHeader title="Document" />
        <PageBody>{error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-muted-foreground">Loading the document…</p>}</PageBody>
      </>
    );

  return (
    <>
      <SiteHeader title={s.name}>
        {s.signed && (
          <Button size="sm" onClick={() => void download("signed")} data-esign-download="">
            <Icon name="download" /> <span className="hidden sm:inline">Signed PDF</span>
          </Button>
        )}
        {s.status === "pending" && !s.finishing && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void act(() => api(`${API}/submissions/${s.id}/remind`, { method: "POST" }), "Reminder sent.")}
              data-esign-remind=""
            >
              <Icon name="bell" /> <span className="hidden sm:inline">Remind</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog("void")} data-esign-void="">
              <Icon name="ban" /> <span className="hidden sm:inline">Void</span>
            </Button>
          </>
        )}
        {(s.status === "voided" || s.status === "declined") && (
          <Button size="sm" variant="ghost" onClick={() => setDialog("delete")}>
            <Icon name="trash" /> <span className="hidden sm:inline">Delete</span>
          </Button>
        )}
      </SiteHeader>
      <PageBody className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="grid min-w-0 gap-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <StatusBadge status={s.status} />
            <span>
              Sent {fmtDateTime(s.createdAt)}
              {s.createdBy ? ` by ${s.createdBy}` : ""}
            </span>
            {s.completedAt && <span>Completed {fmtDateTime(s.completedAt)}</span>}
            <span>{s.ordered ? "Signers sign in order" : "Signers sign at the same time"}</span>
          </div>
          {s.finishing && (
            <Notice tone="info">
              Everyone signed. eSign is making the signed PDF. This takes a few seconds.{" "}
              <Button
                size="sm"
                variant="outline"
                className="ml-2"
                disabled={busy}
                onClick={() => void act(() => api(`${API}/submissions/${s.id}/finish`, { method: "POST" }), "The signed PDF is ready.")}
              >
                Try again
              </Button>
            </Notice>
          )}

          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-base">Signers</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 px-4">
              {s.signersDetail.map((x) => (
                <div key={x.id} className="grid gap-1 rounded-lg border p-3 sm:grid-cols-[1fr_auto] sm:items-center" data-esign-signer-row={x.status}>
                  <div className="grid min-w-0 gap-0.5">
                    <span className="truncate font-medium">
                      {s.ordered ? `${x.position + 1}. ` : ""}
                      {x.name} <span className="font-normal text-muted-foreground">({x.roleName})</span>
                    </span>
                    <span className="truncate text-sm text-muted-foreground">{x.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {x.completedAt
                        ? `Signed ${fmtDateTime(x.completedAt)}`
                        : x.openedAt
                          ? `Opened ${fmtDateTime(x.openedAt)}`
                          : x.sentAt
                            ? `Sent ${fmtDateTime(x.sentAt)}`
                            : "Gets the email after the signer before signs"}
                      {x.remindedAt && !x.completedAt ? ` · reminded ${fmtDateTime(x.remindedAt)}` : ""}
                    </span>
                    {x.declineReason && <span className="text-sm">Reason: {x.declineReason}</span>}
                  </div>
                  <SignerBadge status={x.status} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-base">Audit log</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <ol className="grid gap-2 text-sm" data-esign-audit="">
                {s.events.map((e, i) => (
                  <li key={i} className="grid gap-0.5 border-l-2 pl-3 sm:grid-cols-[11rem_1fr] sm:gap-3">
                    <span className="text-muted-foreground tabular">{fmtDateTime(e.at)}</span>
                    <span>
                      {EVENT_LABELS[e.kind] ?? e.kind}
                      {e.signer ? `: ${e.signer}` : ""}
                      {e.detail && e.kind !== "sent" && e.kind !== "reminded" ? ` (${e.detail})` : ""}
                      {e.ip ? <span className="text-muted-foreground"> · IP {e.ip}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <aside className="grid gap-4">
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-base">Files</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 px-4 text-sm">
              <div className="grid gap-1">
                <span className="text-muted-foreground">Original</span>
                <button type="button" className="w-fit text-left underline underline-offset-2" onClick={() => void download("file")}>
                  {s.fileName}
                </button>
                <code className="text-xs break-all text-muted-foreground">SHA-256 {s.fileHash}</code>
              </div>
              {s.signed && (
                <div className="grid gap-1" data-esign-signed-hash="">
                  <span className="text-muted-foreground">Signed PDF ({fmtBytes(s.signed.size)})</span>
                  <code className="text-xs break-all">SHA-256 {s.signed.hash}</code>
                </div>
              )}
              {s.docsPath && (
                <Link to={s.docsPath} className="flex items-center gap-1 underline underline-offset-2">
                  <Icon name="doc" /> Open the copy in Docs
                </Link>
              )}
              {s.templateId && (
                <Link to={`${ESIGN_HOME}/t/${s.templateId}`} className="flex items-center gap-1 underline underline-offset-2">
                  <Icon name="template" /> Open the template
                </Link>
              )}
            </CardContent>
          </Card>
          {s.signed && (
            <Card className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-base">Check a copy</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 px-4 text-sm">
                <p className="text-muted-foreground">
                  Choose a copy of the signed PDF. Your browser compares its hash with the hash above. The file does not leave your computer.
                </p>
                <Input
                  type="file"
                  accept="application/pdf,.pdf"
                  aria-label="Choose a copy of the signed PDF"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setCheck({ name: f.name, match: (await sha256File(f)) === s.signed!.hash });
                  }}
                  data-esign-check=""
                />
                {check && (
                  <Notice tone={check.match ? "info" : "error"}>
                    {check.match
                      ? `${check.name} matches. It is the signed PDF, with no changes.`
                      : `${check.name} does not match. It is not this signed PDF, or it was changed.`}
                  </Notice>
                )}
              </CardContent>
            </Card>
          )}
          {s.message && (
            <Card className="gap-2 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-base">Note to the signers</CardTitle>
              </CardHeader>
              <CardContent className="px-4 text-sm whitespace-pre-line">{s.message}</CardContent>
            </Card>
          )}
        </aside>
      </PageBody>

      {dialog === "void" && (
        <Modal
          title="Void this document?"
          description="The signing links stop working. Signers who have the email get a short notice."
          onClose={() => setDialog(null)}
        >
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" maxLength={300} aria-label="Reason" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setDialog(null);
                void act(() => api(`${API}/submissions/${s.id}/void`, { method: "POST", body: { reason } }), "The document is voided.");
              }}
            >
              Void
            </Button>
          </div>
        </Modal>
      )}
      {dialog === "delete" && (
        <Modal title="Delete this document?" description="This deletes the document and its audit log." onClose={() => setDialog(null)}>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  await api(`${API}/submissions/${s.id}`, { method: "DELETE" });
                  toast("The document is deleted.");
                  navigate(ESIGN_HOME);
                } catch (e) {
                  toast(errorText(e));
                  setDialog(null);
                }
              }}
            >
              Delete
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
