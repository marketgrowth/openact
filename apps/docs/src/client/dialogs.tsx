import { useState } from "react";
import { api, errorText, Field, Icon, Modal, useToast } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Separator } from "@openact/ui/components/separator";

/** Makes, copies, replaces and turns off the share link of a doc. */
export function ShareDialog({
  docId,
  url,
  onChanged,
  onClose
}: {
  docId: string;
  url: string | null;
  onChanged: (url: string | null) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const make = async (replace: boolean) => {
    setBusy(true);
    try {
      const r = await api<{ shareUrl: string }>(`/api/apps/docs/docs/${docId}/share`, { method: "POST" });
      onChanged(r.shareUrl);
      toast(replace ? "The new link is ready. The old link no longer works." : "The share link is ready.");
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await api(`/api/apps/docs/docs/${docId}/share`, { method: "DELETE" });
      onChanged(null);
      toast("The link is off. Nobody can open the doc with it now.");
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast("Copied the link.");
    } catch {
      toast("Select the link to copy it.");
    }
  };

  return (
    <Modal
      title="Share this doc"
      description="Anyone with the link can read the doc and print it. They cannot change it, and they do not need an account."
      onClose={onClose}
    >
      {url ? (
        <>
          <Field label="Share link" htmlFor="doc-share-url" help="The link always shows the latest saved version.">
            <div className="flex gap-2">
              <Input id="doc-share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" data-share-url="" />
              <Button type="button" variant="outline" onClick={copy} aria-label="Copy the link">
                <Icon name="copy" /> Copy
              </Button>
            </div>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={url} target="_blank" rel="noreferrer">
                <Icon name="external" /> Open
              </a>
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => make(true)}>
              Make a new link
            </Button>
          </div>
          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Turn the link off to stop all access through it.</p>
            <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={turnOff} data-share-off="">
              Turn off link
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">This doc has no share link. Only people in the project can open it.</p>
          <Button type="button" disabled={busy} onClick={() => make(false)} data-share-make="">
            <Icon name="share" /> Make share link
          </Button>
        </div>
      )}
    </Modal>
  );
}

/** Adds, changes or removes a link on the selected text. */
export function LinkDialog({
  current,
  onSave,
  onRemove,
  onClose
}: {
  current: string;
  onSave: (href: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [href, setHref] = useState(current);
  const [problem, setProblem] = useState<string | null>(null);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    let v = href.trim();
    if (!v) return onRemove();
    if (!/^(https?:|mailto:|tel:|#)/i.test(v)) v = `https://${v}`;
    try {
      if (!v.startsWith("#") && !/^(mailto|tel):/i.test(v)) new URL(v);
    } catch {
      setProblem("This is not a web address. Use an address such as https://example.com.");
      return;
    }
    onSave(v);
  };

  return (
    <Modal title={current ? "Edit link" : "Add link"} onClose={onClose}>
      <form className="grid gap-4" onSubmit={save}>
        <Field label="Web address" htmlFor="doc-link-href" help={problem ?? "The link opens in a new tab."}>
          <Input id="doc-link-href" autoFocus value={href} placeholder="https://example.com" onChange={(e) => setHref(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          {current && (
            <Button type="button" variant="ghost" onClick={onRemove}>
              <Icon name="unlink" /> Remove link
            </Button>
          )}
          <Button type="submit">Save link</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Asks before a doc is deleted. */
export function DeleteDialog({ title, onDelete, onClose }: { title: string; onDelete: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Delete this doc?"
      description={`"${title}" and its images are deleted for everyone. Its share link stops working. You cannot undo this.`}
      onClose={onClose}
    >
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onDelete();
            setBusy(false);
          }}
          data-delete-doc=""
        >
          Delete doc
        </Button>
      </div>
    </Modal>
  );
}
