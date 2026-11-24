import { useState } from "react";
import { Field, Icon, Modal, Notice, PageBody, SiteHeader, api, errorText } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent } from "@openact/ui/components/card";
import { Input } from "@openact/ui/components/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@openact/ui/components/table";
import { cn } from "@openact/ui/lib/utils";
import { clockText, entryCents, hoursOne, moneyText, type ClientInfo, type EntryInfo, type ProjectInfo, type TimeLogData, type WeekPart } from "../shared/projects";
import { addDays, weekStart } from "../shared/rules";
import { companyApi, dayText, useCompanyData, useMe } from "./lib";
import { EntryDialog, StatusBadge, localToday } from "./project-parts";

/** Time log: one person's week by project. Managers check it, then approve it, return it or send it to the client. */
export default function TimeLogPage() {
  const me = useMe();
  const [week, setWeek] = useState(() => weekStart(localToday()));
  const [userId, setUserId] = useState<string | null>(null);
  const log = useCompanyData<TimeLogData>(`/time-log?week=${week}${userId ? `&userId=${userId}` : ""}`);
  const picks = useCompanyData<{ projects: ProjectInfo[] }>(me.data?.canTrack ? "/projects" : null);
  const clients = useCompanyData<{ clients: ClientInfo[] }>(me.data?.canTrack || me.data?.canManageAll ? "/clients" : null);
  const d = log.data;
  const companyId = log.companyId;
  const [editing, setEditing] = useState<EntryInfo | "new" | null>(null);
  const [returning, setReturning] = useState<WeekPart | null>(null);
  const [link, setLink] = useState<{
    url: string;
    emailed: string;
    client: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(path: string, body: Record<string, unknown>, after?: (r: any) => void) {
    if (!companyId || !d) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api(`${companyApi(companyId)}/weeks/${d.week}/${path}`, {
        method: "POST",
        body
      });
      after?.(r);
      log.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  // Rows: one per project and task. Columns: the seven days.
  const rows = new Map<
    string,
    {
      label: string;
      sub: string;
      byDay: Map<string, number>;
      minutes: number;
      cents: number;
      entries: EntryInfo[];
    }
  >();
  for (const e of d?.entries ?? []) {
    const key = `${e.projectId}:${e.taskId ?? ""}`;
    const row = rows.get(key) ?? {
      label: e.clientName ? `${e.clientName} · ${e.projectName}` : e.projectName,
      sub: e.taskName || "No task",
      byDay: new Map<string, number>(),
      minutes: 0,
      cents: 0,
      entries: [] as EntryInfo[]
    };
    row.byDay.set(e.date, (row.byDay.get(e.date) ?? 0) + e.minutes);
    row.minutes += e.minutes;
    row.cents += entryCents(e);
    row.entries.push(e);
    rows.set(key, row);
  }
  const dayTotal = (date: string) => (d?.entries ?? []).filter((e) => e.date === date).reduce((n, e) => n + e.minutes, 0);
  const total = (d?.entries ?? []).reduce((n, e) => n + e.minutes, 0);
  const cents = (d?.entries ?? []).reduce((n, e) => n + entryCents(e), 0);
  const parts = (d?.parts ?? []).filter((p) => p.minutes > 0 || p.status !== "open");

  return (
    <>
      <SiteHeader title="Time log">
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Last week" onClick={() => setWeek(addDays(week, -7))}>
            <Icon name="left" />
          </Button>
          <span className="px-1 text-sm font-medium whitespace-nowrap">{d ? `${dayText(d.dates[0]!)} to ${dayText(d.dates[6]!)}` : "Loading…"}</span>
          <Button variant="outline" size="icon" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}>
            <Icon name="right" />
          </Button>
        </div>
      </SiteHeader>
      <PageBody>
        {log.error && <Notice tone="error">{log.error}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {d && (
          <div className={cn("grid gap-4", d.canManage && "lg:grid-cols-[16rem_minmax(0,1fr)]")}>
            {d.canManage && (
              <Card className="self-start py-2">
                <CardContent className="grid gap-1 px-2">
                  <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Team this week</p>
                  {!d.people.length && <p className="px-2 py-1 text-sm text-muted-foreground">No one logged time this week.</p>}
                  {d.people.map((p) => (
                    <button
                      key={p.userId}
                      type="button"
                      onClick={() => setUserId(p.userId)}
                      aria-current={p.userId === d.userId ? "true" : undefined}
                      className={cn("flex min-h-11 items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-muted", p.userId === d.userId && "bg-muted")}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.kind === "freelancer" ? "Freelancer" : "Staff"} · {hoursOne(p.minutes)}
                        </span>
                      </span>
                      <StatusBadge status={p.status} />
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}

            <div className="grid min-w-0 gap-4">
              <Card>
                <CardContent className="grid gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">{d.personName}</h2>
                      <p className="text-sm text-muted-foreground">
                        {hoursOne(total)} · {moneyText(cents, d.currency)} billable
                      </p>
                    </div>
                    {d.isSelf && me.data?.canTrack && (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => setEditing("new")}>
                          <Icon name="plus" />
                          Add time
                        </Button>
                        <Button onClick={() => act("send", {})} disabled={busy || !d.parts.some((p) => p.minutes > 0 && (p.status === "open" || p.status === "returned"))}>
                          Send week
                        </Button>
                      </div>
                    )}
                  </div>
                  {parts.length > 0 && (
                    <ul className="grid gap-2">
                      {parts.map((p) => (
                        <li key={p.clientId ?? "none"} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border p-3">
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{p.clientName}</span>
                            <span className="block text-xs text-muted-foreground">
                              {hoursOne(p.minutes)} · {moneyText(p.cents, d.currency)}
                              {p.decidedBy ? ` · ${p.status === "approved" ? "Approved" : "Returned"} by ${p.decidedBy}` : ""}
                              {p.note ? ` · ${p.note}` : ""}
                            </span>
                          </span>
                          <StatusBadge status={p.status} />
                          {d.canManage && !d.isSelf && p.status === "sent" && (
                            <span className="flex flex-wrap gap-2">
                              <Button size="sm" variant="outline" onClick={() => setReturning(p)} disabled={busy}>
                                Return
                              </Button>
                              {p.hasApprover && p.clientId && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    act(
                                      "link",
                                      {
                                        userId: d.userId,
                                        clientId: p.clientId
                                      },
                                      (r) =>
                                        setLink({
                                          url: r.url,
                                          emailed: r.emailed,
                                          client: p.clientName
                                        })
                                    )
                                  }
                                >
                                  Send to {p.clientName}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  act("decide", {
                                    userId: d.userId,
                                    clientId: p.clientId,
                                    action: "approve"
                                  })
                                }
                              >
                                Approve
                              </Button>
                            </span>
                          )}
                          {me.data?.canSetup && (p.status === "approved" || p.status === "returned") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                act("reopen", {
                                  userId: d.userId,
                                  clientId: p.clientId
                                })
                              }
                            >
                              Reopen
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {d.canManage && d.isSelf && parts.some((p) => p.status === "sent") && <p className="text-xs text-muted-foreground">Another manager approves your own hours.</p>}
                </CardContent>
              </Card>

              <Card className="overflow-hidden p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-56">Project and task</TableHead>
                        {d.dates.map((date) => (
                          <TableHead key={date} className="text-right whitespace-nowrap">
                            {dayText(date).replace(/,.*/, "")} {Number(date.slice(8))}
                          </TableHead>
                        ))}
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!rows.size && (
                        <TableRow>
                          <TableCell colSpan={10} className="text-sm text-muted-foreground">
                            No time this week.
                          </TableCell>
                        </TableRow>
                      )}
                      {[...rows.entries()].map(([key, r]) => (
                        <TableRow key={key}>
                          <TableCell>
                            <div className="font-medium">{r.label}</div>
                            <div className="text-xs text-muted-foreground">{r.sub}</div>
                          </TableCell>
                          {d.dates.map((date) => {
                            const m = r.byDay.get(date) ?? 0;
                            const cellEntries = r.entries.filter((e) => e.date === date);
                            const editable = d.isSelf && cellEntries.length === 1 && cellEntries[0]!.status !== "approved";
                            return (
                              <TableCell key={date} className="text-right tabular-nums">
                                {m ? (
                                  editable ? (
                                    <button type="button" className="rounded px-1 underline-offset-4 hover:underline" onClick={() => setEditing(cellEntries[0]!)}>
                                      {clockText(m)}
                                    </button>
                                  ) : (
                                    clockText(m)
                                  )
                                ) : (
                                  <span className="text-muted-foreground">·</span>
                                )}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-right font-medium tabular-nums">{clockText(r.minutes)}</TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">{r.cents ? moneyText(r.cents, d.currency) : "None"}</TableCell>
                        </TableRow>
                      ))}
                      {rows.size > 0 && (
                        <TableRow className="bg-muted/50">
                          <TableCell className="font-medium">Total</TableCell>
                          {d.dates.map((date) => (
                            <TableCell key={date} className="text-right tabular-nums">
                              {dayTotal(date) ? clockText(dayTotal(date)) : "·"}
                            </TableCell>
                          ))}
                          <TableCell className="text-right font-medium tabular-nums">{clockText(total)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{moneyText(cents, d.currency)}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </Card>
              <p className="text-xs text-muted-foreground">
                A client with an approver email can approve their hours from a link. A manager approves the other hours. No one approves their own week. Approved hours lock, and
                their rates are saved.
              </p>
            </div>
          </div>
        )}
      </PageBody>

      {editing && companyId && (
        <EntryDialog
          companyId={companyId}
          entry={editing === "new" ? null : editing}
          date={d?.dates.includes(localToday()) ? localToday() : (d?.dates[1] ?? localToday())}
          projects={picks.data?.projects ?? []}
          clients={clients.data?.clients ?? []}
          onClose={() => setEditing(null)}
          onSaved={log.reload}
        />
      )}
      {returning && d && (
        <ReturnDialog
          part={returning}
          onClose={() => setReturning(null)}
          onReturn={(note) =>
            act(
              "decide",
              {
                userId: d.userId,
                clientId: returning.clientId,
                action: "return",
                note
              },
              () => setReturning(null)
            )
          }
        />
      )}
      {link && (
        <Modal title={`Sent to ${link.client}`} onClose={() => setLink(null)}>
          <p className="text-sm">
            {link.emailed === "sent" ? "The approver got an email with this link." : "Email is not set up on this site, so no email went out. Copy the link and send it yourself."}{" "}
            The link works for 14 days.
          </p>
          <Input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label="Approval link" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => navigator.clipboard?.writeText(link.url)}>
              <Icon name="copy" />
              Copy link
            </Button>
            <Button onClick={() => setLink(null)}>Done</Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function ReturnDialog({ part, onClose, onReturn }: { part: WeekPart; onClose: () => void; onReturn: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Modal title={`Return ${part.clientName} hours`} description="The person sees your note on My time. They fix the hours, then send the week again." onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim()) onReturn(note.trim());
        }}
      >
        <Field label="What should they fix?" htmlFor="ws-return-note">
          <Input id="ws-return-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} required />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!note.trim()}>
            Return
          </Button>
        </div>
      </form>
    </Modal>
  );
}
