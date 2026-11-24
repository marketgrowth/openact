import { useEffect, useState } from "react";
import { Field, Notice } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@openact/ui/components/card";
import { Textarea } from "@openact/ui/components/textarea";
import { clockText, hoursOne, moneyText, type ApprovalView } from "../shared/projects";
import { API } from "../shared/rules";
import { dayText } from "./lib";

/*
 * The client approval page. No sign-in: the link carries a token after # so it never reaches a server log.
 * The client sees only their own hours for one week, then approves them or asks a question. The link then stops working.
 */

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}/approve${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit"
  });
  const data = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!res.ok) throw new Error(data?.error ?? `The request failed (${res.status}).`);
  return data as T;
}

const tokenOf = () => new URLSearchParams(window.location.hash.replace(/^#/, "")).get("t") ?? "";

export default function ApprovePage() {
  const [token] = useState(tokenOf);
  const [view, setView] = useState<ApprovalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "returned" | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return setError("This link is not complete. Open the link from the email again.");
    post<ApprovalView>("/view", { token }).then(setView, (e) => setError((e as Error).message));
  }, [token]);

  async function decide(action: "approve" | "question") {
    setBusy(true);
    setError(null);
    try {
      await post("/decide", { token, action, note });
      setDone(action === "approve" ? "approved" : "returned");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-xl content-start gap-4 px-4 py-8">
      {error && <Notice tone="error">{error}</Notice>}
      {view && (
        <Card>
          <CardHeader>
            <CardDescription>{view.companyName} · WorkSpent</CardDescription>
            <CardTitle className="text-xl">
              {done === "approved" ? "Approved. Thank you." : done === "returned" ? "Your question was sent." : `Approve hours for ${view.clientName}`}
            </CardTitle>
            <CardDescription>
              {done === "approved"
                ? `You approved ${hoursOne(view.minutes)} for the week of ${dayText(view.week)}. ${view.companyName} can see this now.`
                : done === "returned"
                  ? `${view.companyName} sees your question. They will fix the hours and send them again.`
                  : `${view.personName} worked ${hoursOne(view.minutes)} for you in the week of ${dayText(view.week)}. Check the hours, then approve them.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ul className="divide-y">
              {view.entries.map((e, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-xs text-muted-foreground">{dayText(e.date)}</span>
                    <span className="block text-sm">{[e.projectName, e.taskName].filter(Boolean).join(" · ")}</span>
                    {e.note && <span className="block text-xs text-muted-foreground">{e.note}</span>}
                  </span>
                  <span className="text-sm font-medium tabular-nums">{clockText(e.minutes)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between text-sm font-medium">
              <span>Total</span>
              <span className="tabular-nums">
                {clockText(view.minutes)}
                {view.cents ? ` · ${moneyText(view.cents, view.currency)}` : ""}
              </span>
            </div>
            {!done && !asking && (
              <div className="grid gap-2">
                <Button size="lg" onClick={() => decide("approve")} disabled={busy}>
                  Approve {hoursOne(view.minutes)}
                </Button>
                <Button size="lg" variant="outline" onClick={() => setAsking(true)} disabled={busy}>
                  Ask a question
                </Button>
                <p className="text-center text-xs text-muted-foreground">The link works once, for this week only.</p>
              </div>
            )}
            {!done && asking && (
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (note.trim()) decide("question");
                }}
              >
                <Field label="Your question" htmlFor="ws-approve-note" help="The hours go back to the team. They fix them and send them to you again.">
                  <Textarea id="ws-approve-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} required />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setAsking(false)}>
                    Back
                  </Button>
                  <Button type="submit" disabled={busy || !note.trim()}>
                    Send question
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}
      {!view && !error && <p className="text-sm text-muted-foreground">Loading the hours…</p>}
    </main>
  );
}
