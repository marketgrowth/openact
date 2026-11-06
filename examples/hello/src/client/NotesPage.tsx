import { useCallback, useEffect, useState } from "react";
import { PageBody, SiteHeader, api, errorText, fmtDateTime, useToast, useWorkspace } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Textarea } from "@openact/ui/components/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@openact/ui/components/card";

interface Note {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

export default function NotesPage() {
  const { current } = useWorkspace();
  const toast = useToast();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [body, setBody] = useState("");
  const base = current ? `/api/apps/hello/companies/${current.id}/notes` : null;

  const load = useCallback(() => {
    if (base)
      api<{ notes: Note[] }>(base).then(
        (r) => setNotes(r.notes),
        (e) => toast(errorText(e))
      );
  }, [base, toast]);
  useEffect(load, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!base) return;
    try {
      await api(base, { body: { body } });
      setBody("");
      load();
    } catch (err) {
      toast(errorText(err));
    }
  };

  return (
    <>
      <SiteHeader title="Notes" />
      <PageBody className="max-w-3xl">
        <Card className="gap-4 shadow-xs">
          <CardHeader>
            <CardTitle>Write a note for {current?.name ?? "your company"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={add}>
              <Textarea
                aria-label="Note"
                rows={3}
                maxLength={500}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Everyone in the company can read it."
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={!body.trim()}>
                  Add note
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
        {notes === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {notes?.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
        <ul className="grid gap-3" data-hello-notes="">
          {notes?.map((n) => (
            <li key={n.id} className="rounded-lg border bg-card p-4 text-sm shadow-xs">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {n.author}, {fmtDateTime(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      </PageBody>
    </>
  );
}
