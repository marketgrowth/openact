import { useState } from "react";
import { Field, Icon, Notice, PageBody, SiteHeader } from "@openact/ui";
import { MetricCard } from "@openact/ui/arc/metric-card";
import { Button } from "@openact/ui/components/button";
import { Card } from "@openact/ui/components/card";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@openact/ui/components/table";
import { hoursOne, moneyText, type GroupBy, type MemberInfo, type ReportData } from "../shared/projects";
import { addDays, weekStart } from "../shared/rules";
import { companyApi, useCompanyData, useMe } from "./lib";
import { localToday } from "./project-parts";

/** Reports: hours and amounts for any dates, to bill clients and to pay freelancers. Members see their own time. */

type Range = "this-week" | "last-week" | "this-month" | "last-month" | "custom";
const RANGES: Array<[Range, string]> = [
  ["this-week", "This week"],
  ["last-week", "Last week"],
  ["this-month", "This month"],
  ["last-month", "Last month"],
  ["custom", "Pick dates"]
];
const GROUP_LABELS: Record<GroupBy, string> = {
  client: "By client, then project",
  project: "By project, then client",
  person: "By person, then project",
  task: "By task, then person"
};

function rangeDates(r: Range, from: string, to: string): [string, string] {
  const today = localToday();
  const month = today.slice(0, 8) + "01";
  if (r === "this-week") return [weekStart(today), addDays(weekStart(today), 6)];
  if (r === "last-week") return [addDays(weekStart(today), -7), addDays(weekStart(today), -1)];
  if (r === "this-month") return [month, addDays(nextMonth(month), -1)];
  if (r === "last-month") {
    const start = prevMonth(month);
    return [start, addDays(month, -1)];
  }
  return [from, to];
}
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
};
const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 1 ? `${y - 1}-12-01` : `${y}-${String(mo - 1).padStart(2, "0")}-01`;
};

export default function ReportsPage() {
  const me = useMe();
  const manages = !!me.data?.canManageAll;
  const [range, setRange] = useState<Range>("this-month");
  const [custom, setCustom] = useState<[string, string]>([addDays(localToday(), -30), localToday()]);
  const [groupBy, setGroupBy] = useState<GroupBy>("client");
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState("all");
  const [from, to] = rangeDates(range, custom[0], custom[1]);
  const query = `from=${from}&to=${to}&groupBy=${groupBy}${userId ? `&userId=${userId}` : ""}${status === "approved" ? "&status=approved" : ""}`;
  const report = useCompanyData<ReportData>(me.data ? `/reports?${query}` : null);
  const team = useCompanyData<{ members: MemberInfo[] }>(manages || me.data?.canSetup ? "/team" : null);
  const d = report.data;
  const money = (c: number) => (d ? moneyText(c, d.currency) : "");

  return (
    <>
      <SiteHeader title="Reports">
        {report.companyId && (
          <Button variant="outline" size="sm" asChild className="ml-auto">
            <a href={`${companyApi(report.companyId)}/reports/export?${query}`} download>
              <Icon name="download" />
              Export CSV
            </a>
          </Button>
        )}
      </SiteHeader>
      <PageBody>
        {report.error && <Notice tone="error">{report.error}</Notice>}
        {me.data && !manages && <p className="text-sm text-muted-foreground">You see your own time. Managers see everyone's.</p>}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Dates" htmlFor="ws-report-range">
            <NativeSelect id="ws-report-range" value={range} onChange={(e) => setRange(e.target.value as Range)} className="w-44">
              {RANGES.map(([v, l]) => (
                <NativeSelectOption key={v} value={v}>
                  {l}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {range === "custom" && (
            <>
              <Field label="From" htmlFor="ws-report-from">
                <Input id="ws-report-from" type="date" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} className="w-40" />
              </Field>
              <Field label="To" htmlFor="ws-report-to">
                <Input id="ws-report-to" type="date" value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} className="w-40" />
              </Field>
            </>
          )}
          <Field label="Group" htmlFor="ws-report-group">
            <NativeSelect id="ws-report-group" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="w-52">
              {(Object.keys(GROUP_LABELS) as GroupBy[]).map((g) => (
                <NativeSelectOption key={g} value={g}>
                  {GROUP_LABELS[g]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {manages && (
            <Field label="People" htmlFor="ws-report-person">
              <NativeSelect id="ws-report-person" value={userId} onChange={(e) => setUserId(e.target.value)} className="w-48">
                <NativeSelectOption value="">Everyone</NativeSelectOption>
                {team.data?.members.map((m) => (
                  <NativeSelectOption key={m.userId} value={m.userId}>
                    {m.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Hours" htmlFor="ws-report-status">
            <NativeSelect id="ws-report-status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
              <NativeSelectOption value="all">All hours</NativeSelectOption>
              <NativeSelectOption value="approved">Approved hours only</NativeSelectOption>
            </NativeSelect>
          </Field>
        </div>

        {d && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Hours" value={Math.round(d.totals.minutes / 6) / 10} suffix=" h" context={`${hoursOne(d.totals.minutes)}, ${from} to ${to}`} />
              <MetricCard label="Billable hours" value={Math.round(d.totals.billableMinutes / 6) / 10} suffix=" h" context={`${hoursOne(d.totals.billableMinutes)} that bill`} />
              <MetricCard label={`Amount (${d.currency})`} value={Math.round(d.totals.cents / 100)} context={money(d.totals.cents)} />
              <MetricCard label="Budgets near the limit" value={d.budgetsNearLimit} context="Projects at 80% or more of their budget" />
            </div>
            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{GROUP_LABELS[d.groupBy].replace(/^By /, "").replace(/^./, (c) => c.toUpperCase())}</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Billable</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!d.groups.length && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-sm text-muted-foreground">
                          No time in these dates.
                        </TableCell>
                      </TableRow>
                    )}
                    {d.groups.map((g) => (
                      <GroupRows key={g.key} g={g} money={money} />
                    ))}
                    {d.groups.length > 0 && (
                      <TableRow>
                        <TableCell className="font-medium">Total</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{hoursOne(d.totals.minutes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{hoursOne(d.totals.billableMinutes)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{money(d.totals.cents)}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
            {me.data?.shifts && <p className="text-xs text-muted-foreground">Shift hours stay on Timesheets, with the payroll CSV for each pay period.</p>}
          </>
        )}
      </PageBody>
    </>
  );
}

function GroupRows({ g, money }: { g: ReportData["groups"][number]; money: (c: number) => string }) {
  return (
    <>
      <TableRow className="bg-muted/50">
        <TableCell className="font-medium">{g.label}</TableCell>
        <TableCell className="text-right font-medium tabular-nums">{hoursOne(g.minutes)}</TableCell>
        <TableCell className="text-right tabular-nums">{hoursOne(g.billableMinutes)}</TableCell>
        <TableCell className="text-right font-medium tabular-nums">{g.cents ? money(g.cents) : "None"}</TableCell>
      </TableRow>
      {g.rows.map((r) => (
        <TableRow key={r.key}>
          <TableCell className="pl-8">{r.label}</TableCell>
          <TableCell className="text-right tabular-nums">{hoursOne(r.minutes)}</TableCell>
          <TableCell className="text-right text-muted-foreground tabular-nums">{hoursOne(r.billableMinutes)}</TableCell>
          <TableCell className="text-right tabular-nums">{r.cents ? money(r.cents) : "None"}</TableCell>
        </TableRow>
      ))}
    </>
  );
}
