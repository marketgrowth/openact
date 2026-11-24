import { useState } from "react";
import { Notice, PageBody, SiteHeader, api, errorText } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@openact/ui/components/card";
import { Input } from "@openact/ui/components/input";
import { cn } from "@openact/ui/lib/utils";
import { PUNCH_LABELS, durationText, localDate, type MyTime, type UpcomingShift } from "../shared/rules";
import { FlagBadges, companyApi, dayText, periodText, timeText, useCompanyData } from "./lib";

/** My time: your own hours this pay period, and the fixes a manager made to them. */
export default function MyTimePage() {
  const mine = useCompanyData<MyTime>("/my-time");
  const d = mine.data;
  const open = d?.changes.filter((c) => !c.response) ?? [];
  const done = d?.changes.filter((c) => c.response) ?? [];

  return (
    <>
      <SiteHeader title="My time" />
      <PageBody className="max-w-4xl">
        {mine.error && <Notice tone="error">{mine.error}</Notice>}
        {d && !d.person && (
          <Notice tone="info">
            Your account is not linked to a person in WorkSpent. Ask a company owner or admin to link it in People and PINs. You can still clock in with your PIN on a time
            clock device.
          </Notice>
        )}
        {d?.person && (
          <p className="text-sm text-muted-foreground">
            Hello, {d.person.name.replace(/\.$/, "")}. You clock in with your PIN on the time clock device at your location. These are your hours. Your payroll provider keeps your pay rate.
          </p>
        )}

        {d?.person && <MySchedule upcoming={d.upcoming} />}

        {open.length > 0 && mine.companyId && (
          <Card>
            <CardHeader>
              <CardTitle>Fixes to check</CardTitle>
              <CardDescription>A manager changed your hours. Confirm each fix, or question it.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {groups(open).map((g) => (
                <Respond key={g[0]!.id} companyId={mine.companyId!} changes={g} onDone={mine.reload} />
              ))}
            </CardContent>
          </Card>
        )}

        {d?.locations.map((l) => (
          <Card key={l.location.id}>
            <CardHeader>
              <CardTitle>{l.location.name}</CardTitle>
              <CardDescription>
                {periodText(l.period)} · {durationText(l.sheet.minutes)}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {l.sheet.days.length === 0 && <p className="text-sm text-muted-foreground">No hours in this pay period yet.</p>}
              {l.sheet.days.map((day) => {
                const shifts = l.sheet.shifts.filter((s) => s.date === day.date);
                const punches = l.punches.filter((p) => localDate(Date.parse(p.at), l.location.timeZone) === day.date);
                return (
                  <section key={day.date} className="grid gap-1 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium">{dayText(day.date)}</h3>
                      <span className="text-sm tabular-nums">{durationText(day.minutes)}</span>
                    </div>
                    <FlagBadges flags={shifts.flatMap((s) => s.flags).filter((f) => f !== "over_day" && f !== "over_week")} />
                    <ul className="grid gap-0.5 text-sm text-muted-foreground">
                      {punches.map((p) => (
                        <li key={p.id} className={cn(p.isDeleted && "line-through")}>
                          {PUNCH_LABELS[p.kind]}, {timeText(p.at, l.location.timeZone)}
                          {p.source === "manager" ? " · added by a manager" : ""}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </CardContent>
          </Card>
        ))}

        {done.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Fixes you answered</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {done.map((c) => (
                <p key={c.id}>
                  {changeText(c)} · {c.response === "confirmed" ? "You confirmed it." : `You questioned it${c.responseNote ? `: ${c.responseNote}` : "."}`}
                </p>
              ))}
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  );
}

type Change = MyTime["changes"][number];

/** Fixes from one manager action (such as a whole shift) share a time, a manager and a reason. Show them as one card, newest first. */
function groups(list: Change[]): Change[][] {
  const map = new Map<string, Change[]>();
  for (const c of list) {
    const k = `${c.changedAt.slice(0, 19)}|${c.changedBy}|${c.reason}|${c.locationName}`;
    map.set(k, [...(map.get(k) ?? []), c]);
  }
  return [...map.values()].reverse();
}

function changeLine(c: Change): string {
  const when = (iso: string | null) => (iso ? `${dayText(localDate(Date.parse(iso), c.timeZone))} ${timeText(iso, c.timeZone)}` : "");
  const what = PUNCH_LABELS[c.kind];
  return c.action === "add" ? `${what} added at ${when(c.newAt)}` : c.action === "delete" ? `${what} at ${when(c.oldAt)} deleted` : `${what} moved from ${when(c.oldAt)} to ${timeText(c.newAt, c.timeZone)}`;
}

function changeText(c: MyTime["changes"][number]): string {
  return `${c.locationName}: ${changeLine(c)} by ${c.changedBy ?? "a manager"}. Why: ${c.reason}`;
}

function Respond({ companyId, changes, onDone }: { companyId: string; changes: Change[]; onDone: () => void }) {
  const first = changes[0]!;
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function send(response: "confirmed" | "questioned") {
    setError(null);
    try {
      for (const c of changes)
        await api(`${companyApi(companyId)}/changes/${c.id}/respond`, { method: "POST", body: { response, note: response === "questioned" ? note : "" } });
      onDone();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="grid gap-2 rounded-md border p-3 text-sm" data-change={first.id}>
      <p>
        {first.locationName}: {changes.length === 1 ? changeLine(first) : `${changes.length} changes`} by {first.changedBy ?? "a manager"}. Why: {first.reason}
      </p>
      {changes.length > 1 && (
        <ul className="list-disc pl-5 text-muted-foreground">
          {changes.map((c) => (
            <li key={c.id}>{changeLine(c)}</li>
          ))}
        </ul>
      )}
      {asking && <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is wrong? (optional)" aria-label="What is wrong" maxLength={300} />}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        {!asking && (
          <Button size="sm" onClick={() => send("confirmed")}>
            {changes.length > 1 ? "Confirm all" : "Confirm"}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => (asking ? send("questioned") : setAsking(true))}>
          {asking ? "Send the question" : "Question it"}
        </Button>
        {asking && (
          <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

/** The published shifts of the person: the next one first, then the next 3 weeks by day. */
function MySchedule({ upcoming }: { upcoming: UpcomingShift[] }) {
  const now = Date.now();
  const next = upcoming.find((u) => Date.parse(u.endsAt) > now);
  const rest = upcoming.filter((u) => u !== next && Date.parse(u.endsAt) > now);
  const when = (u: UpcomingShift) => `${timeText(u.startsAt, u.timeZone)} to ${timeText(u.endsAt, u.timeZone)}`;
  const day = (u: UpcomingShift) => dayText(localDate(Date.parse(u.startsAt), u.timeZone));
  const minutes = (u: UpcomingShift) => Math.max(0, Math.round((Date.parse(u.endsAt) - Date.parse(u.startsAt)) / 60_000) - u.breakMinutes);
  const startsIn = next ? Math.round((Date.parse(next.startsAt) - now) / 60_000) : 0;
  return (
    <Card data-my-schedule="">
      <CardHeader>
        <CardTitle>My schedule</CardTitle>
        <CardDescription>The shifts a manager set for you. Clock in with your PIN when you arrive.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!next && <p className="text-sm text-muted-foreground">No shifts in the next 3 weeks.</p>}
        {next && (
          <div className="grid gap-1 rounded-lg bg-primary p-4 text-primary-foreground">
            <span className="text-xs opacity-80">{startsIn > 0 ? `Next shift · starts in ${durationText(startsIn)}` : "Now · on your shift"}</span>
            <span className="text-lg font-semibold">
              {day(next)}, {when(next)}
            </span>
            <span className="text-sm opacity-90">
              {next.locationName} · {next.breakMinutes ? `${next.breakMinutes} min meal break · ` : ""}
              {durationText(minutes(next))}
            </span>
            {next.note && <span className="text-sm opacity-90">Note: {next.note}</span>}
          </div>
        )}
        {rest.length > 0 && (
          <ul className="grid gap-1.5">
            {rest.map((u, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{day(u)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {when(u)} · {u.locationName}
                    {u.note ? ` · ${u.note}` : ""}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{durationText(minutes(u))}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
