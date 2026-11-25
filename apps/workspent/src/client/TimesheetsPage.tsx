import { useEffect, useState } from "react";
import { Icon, Link, Notice, PageBody, SiteHeader, api, errorText } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Badge } from "@openact/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@openact/ui/components/card";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@openact/ui/components/table";
import { HOME, hoursText, type LocationInfo, type TimesheetData } from "../shared/rules";
import { FlagBadges, companyApi, periodText, timeText, useCompanyData, useLocationPick, useMe } from "./lib";
import PersonSheet from "./PersonSheet";

/** Timesheets: who is on the clock now, and each person's hours for the pay period. */
export default function TimesheetsPage() {
  const me = useMe();
  const locs = useCompanyData<{ locations: LocationInfo[] }>(me.data && (me.data.canManageAll || me.data.canSetup || me.data.managedLocationIds.length) ? "/locations" : null);
  const [locationId, pickLocation] = useLocationPick(locs.data?.locations ?? null);
  const [start, setStart] = useState<string>("");
  const sheet = useCompanyData<TimesheetData>(locationId ? `/locations/${locationId}/timesheet${start ? `?start=${start}` : ""}` : null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Refresh "On the clock now" every minute.
  const { reload } = sheet;
  useEffect(() => {
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
  }, [reload]);

  const d = sheet.data && sheet.data.location.id === locationId ? sheet.data : null;
  const noAccess = me.data && !me.data.canManageAll && !me.data.canSetup && !me.data.managedLocationIds.length;

  async function approve(reopen: boolean) {
    if (!d || !sheet.companyId) return;
    setBusy(true);
    setProblem(null);
    try {
      await api(`${companyApi(sheet.companyId)}/locations/${d.location.id}/periods/${d.period.start}/${reopen ? "reopen" : "approve"}`, { method: "POST" });
      sheet.reload();
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const exportHref = d && sheet.companyId ? `${companyApi(sheet.companyId)}/locations/${d.location.id}/periods/${d.period.start}/export` : undefined;
  // People with at least one flag to review.
  const flags = d ? d.rows.filter((r) => r.sheet.flagCount > 0).length : 0;
  const minutes = d ? d.rows.reduce((n, r) => n + r.sheet.minutes, 0) : 0;

  return (
    <>
      <SiteHeader title="Timesheets">
        {d && (
          <>
            <Button variant="outline" size="sm" asChild disabled={d.status !== "approved"}>
              <a
                href={d.status === "approved" ? exportHref : undefined}
                aria-disabled={d.status !== "approved"}
                className={d.status !== "approved" ? "pointer-events-none opacity-50" : undefined}
                download
              >
                <Icon name="download" />
                <span className="hidden sm:inline">Export CSV</span>
                <span className="sr-only sm:hidden">Export CSV</span>
              </a>
            </Button>
            {d.status === "approved" ? (
              d.canReopen && (
                <Button variant="outline" size="sm" onClick={() => approve(true)} disabled={busy}>
                  <Icon name="history" />
                  <span className="hidden sm:inline">Reopen the period</span>
                  <span className="sr-only sm:hidden">Reopen the period</span>
                </Button>
              )
            ) : (
              <Button size="sm" onClick={() => approve(false)} disabled={busy || !d.ended} title={d.ended ? undefined : "You can approve the period after its last day."}>
                <Icon name="check" />
                <span className="hidden sm:inline">Approve the period</span>
                <span className="sr-only sm:hidden">Approve the period</span>
              </Button>
            )}
          </>
        )}
      </SiteHeader>
      <PageBody>
        {(me.error || locs.error || sheet.error) && <Notice tone="error">{me.error || locs.error || sheet.error}</Notice>}
        {noAccess && (
          <Notice tone="info">
            You do not manage a location. <Link to={`${HOME}/my-time`} className="underline">See your own hours on My time.</Link>
          </Notice>
        )}
        {locs.data && !locs.data.locations.some((l) => l.canManage && !l.isArchived) && (
          <Notice tone="info">
            There is no location yet.{" "}
            {me.data?.canSetup ? (
              <Link to={`${HOME}/locations`} className="underline">
                Add a location in Locations and devices.
              </Link>
            ) : (
              "Ask a company owner or admin to add one."
            )}
          </Notice>
        )}
        {problem && <Notice tone="error">{problem}</Notice>}

        {locs.data && locationId && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Location</span>
              <NativeSelect
                value={locationId}
                onChange={(e) => {
                  pickLocation(e.target.value);
                  setStart("");
                }}
                aria-label="Location"
              >
                {locs.data.locations
                  .filter((l) => l.canManage && !l.isArchived)
                  .map((l) => (
                    <NativeSelectOption key={l.id} value={l.id}>
                      {l.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </label>
            {d && (
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Pay period</span>
                <NativeSelect value={d.period.start} onChange={(e) => setStart(e.target.value)} aria-label="Pay period">
                  {d.periods.map((p) => (
                    <NativeSelectOption key={p.start} value={p.start}>
                      {periodText(p)}
                      {p.status === "approved" ? " (approved)" : ""}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
            )}
          </div>
        )}

        {d && (
          <>
            {d.status === "open" && !d.ended && (
              <p className="text-sm text-muted-foreground">This pay period is still running. Approve it after its last day, then export the CSV.</p>
            )}
            {d.status === "approved" && (
              <Notice tone="info">
                Approved{d.approvedBy ? ` by ${d.approvedBy}` : ""}. The hours of this period are locked. Export the CSV for your payroll provider.
              </Notice>
            )}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-workspent-stats="">
              <Stat label="On the clock now" value={String(d.onClock.length)} />
              <Stat label="People with flags to review" value={String(flags)} tone={flags ? "warn" : undefined} />
              <Stat label="Hours this period" value={hoursText(minutes)} />
              <Stat label="Time clock devices online" value={`${d.devices.online} of ${d.devices.total}`} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>On the clock now</CardTitle>
                <CardDescription>Updates every minute.</CardDescription>
              </CardHeader>
              <CardContent>
                {d.onClock.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nobody is on the clock at {d.location.name}.</p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {d.onClock.map((p) => (
                      <li key={p.personId} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                        <span className="size-2 shrink-0 rounded-full bg-live" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="font-medium">{p.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {p.state === "on_break" ? `On meal break since ${timeText(p.since, d.location.timeZone)}` : `In at ${timeText(p.since, d.location.timeZone)}`}
                            {p.source ? ` · ${p.source === "manager" ? "Added by a manager" : p.source}` : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>This pay period</CardTitle>
                <CardDescription>
                  Select a name to see each clock-in, or to fix a missed one. WorkSpent keeps hours only. Your payroll provider keeps pay rates and pays people.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0 sm:px-6">
                {d.rows.length === 0 ? (
                  <p className="px-6 text-sm text-muted-foreground sm:px-0">
                    Nobody clocks in at this location yet. Add people in Team.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Person</TableHead>
                        <TableHead className="text-right">Days</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="hidden text-right md:table-cell">Over {d.location.limits.dayHours} a day</TableHead>
                        <TableHead className="hidden text-right md:table-cell">Over {d.location.limits.weekHours} a week</TableHead>
                        <TableHead className="hidden lg:table-cell">Flags</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.rows.map((r) => {
                        const all = r.sheet.shifts.flatMap((s) => s.flags);
                        const missed = all.some((f) => f === "missed_in" || f === "missed_out");
                        return (
                          <TableRow key={r.person.id}>
                            <TableCell>
                              <button type="button" className="text-left font-medium underline-offset-4 hover:underline" onClick={() => setOpen(r.person.id)}>
                                {r.person.name}
                              </button>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{r.sheet.days.filter((x) => x.minutes > 0).length}</TableCell>
                            <TableCell className="text-right tabular-nums">{hoursText(r.sheet.minutes)}</TableCell>
                            <TableCell className="hidden text-right tabular-nums md:table-cell">{hoursText(r.sheet.overDayMinutes)}</TableCell>
                            <TableCell className="hidden text-right tabular-nums md:table-cell">{hoursText(r.sheet.overWeekMinutes)}</TableCell>
                            <TableCell className="hidden lg:table-cell">
                              {all.length ? <FlagBadges flags={all} /> : <span className="text-sm text-muted-foreground">None</span>}
                            </TableCell>
                            <TableCell>
                              {d.status === "approved" ? (
                                <Badge variant="secondary">Approved</Badge>
                              ) : missed ? (
                                <Button size="xs" variant="outline" onClick={() => setOpen(r.person.id)}>
                                  Fix it
                                </Button>
                              ) : all.length ? (
                                <Button size="xs" variant="ghost" onClick={() => setOpen(r.person.id)}>
                                  Review
                                </Button>
                              ) : (
                                <span className="text-sm text-muted-foreground">Ready</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">
              Flags only. The flag rules are set for each location. Your payroll provider applies the pay rules. A fixed entry keeps the original, who changed it and why.
            </p>
          </>
        )}
      </PageBody>
      {open && d && sheet.companyId && (
        <PersonSheet
          companyId={sheet.companyId}
          locationId={d.location.id}
          personId={open}
          start={d.period.start}
          onClose={() => setOpen(null)}
          onChanged={sheet.reload}
        />
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <div className={tone === "warn" ? "text-2xl font-semibold tabular-nums text-warn-foreground" : "text-2xl font-semibold tabular-nums"}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
