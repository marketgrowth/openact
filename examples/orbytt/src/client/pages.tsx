import { useState, type ReactNode } from "react";
import { CompanyMark, Icon, Link, PageBody, SiteHeader, useShell, useWorkspace } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@openact/ui/components/card";
import { Input } from "@openact/ui/components/input";
import { Label } from "@openact/ui/components/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@openact/ui/components/table";
import { ToggleGroup, ToggleGroupItem } from "@openact/ui/components/toggle-group";
import { CONTRACTORS, INTERVIEWS, TALENT, type Talent } from "./data";
import { useOrbytt } from "./state";

/* Pages of the Orbytt mockup. Every page says that it is a mockup, and nothing leaves the browser. */

function Header({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <SiteHeader title={title}>
      {children}
      <Badge variant="outline">Mockup</Badge>
    </SiteHeader>
  );
}

const flag = (c: Talent["country"]) => (c === "PH" ? "Philippines" : "United States");

export function OverviewPage() {
  const { connected } = useOrbytt();
  return (
    <>
      <Header title="Orbytt" />
      <PageBody>{connected ? <Overview /> : <Connect />}</PageBody>
    </>
  );
}

/** One-click employer sign-up: OpenAct shows what it will send, and the owner agrees to the terms. */
function Connect() {
  const { me } = useShell();
  const { current } = useWorkspace();
  const { connect } = useOrbytt();
  const [agree, setAgree] = useState(false);
  const domain = me?.email.split("@")[1] ?? "";
  const rows: Array<[string, ReactNode]> = [
    ["Company", current?.name ?? "No company"],
    ["Logo", current ? <CompanyMark company={current} size={24} className="rounded-md" /> : "None"],
    ["Email domain", domain],
    ["Owner", me?.name || me?.email || ""],
    ["Owner email", <span className="font-mono text-xs">{me?.email}</span>]
  ];
  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader>
        <CardTitle className="text-lg">Connect to Orbytt</CardTitle>
        <CardDescription>Find remote talent in the US and the Philippines, and hire them as contractors on your projects.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm">OpenAct sends this to Orbytt to make your employer account. You do not fill in another form.</p>
        <dl className="grid grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 rounded-lg border p-4 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 truncate">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">OpenAct never sends your people, projects or tasks. Orbytt asks for billing details at your first hire.</p>
        <Label className="flex items-center gap-2 text-sm font-normal">
          <input type="checkbox" className="size-4 accent-primary" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          I agree to the Orbytt Terms of Service.
        </Label>
      </CardContent>
      <CardFooter className="justify-between gap-2">
        <span className="text-xs text-muted-foreground">Mockup: nothing is sent.</span>
        <Button disabled={!agree} onClick={connect}>
          Create account
        </Button>
      </CardFooter>
    </Card>
  );
}

function Overview() {
  const { shortlist } = useOrbytt();
  const { current } = useWorkspace();
  const stats: Array<[string, number, string, string]> = [
    ["Shortlisted", shortlist.length, "star", "/a/orbytt/shortlist"],
    ["Interviews", INTERVIEWS.length, "video", "/a/orbytt/interviews"],
    ["Contractors", CONTRACTORS.length, "briefcase", "/a/orbytt/contractors"]
  ];
  return (
    <>
      <div>
        <h2 className="text-xl font-semibold">{current?.name} is connected to Orbytt</h2>
        <p className="text-sm text-muted-foreground">Find talent, ask for interviews, and add the people you hire to your projects.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map(([label, n, icon, to]) => (
          <Link key={label} to={to} className="rounded-xl border bg-card p-4 text-card-foreground shadow-xs transition-colors hover:bg-accent">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              {label}
              <Icon name={icon} />
            </div>
            <div className="mt-2 text-3xl font-semibold tabular-nums">{n}</div>
          </Link>
        ))}
      </div>
      <div>
        <Button asChild>
          <Link to="/a/orbytt/talent">
            <Icon name="talent" /> Find talent
          </Link>
        </Button>
      </div>
    </>
  );
}

export function TalentPage() {
  const { query, setQuery, shortlist, toggleShortlist } = useOrbytt();
  const [country, setCountry] = useState<"all" | "PH" | "US">("all");
  const q = query.trim().toLowerCase();
  const list = TALENT.filter(
    (t) => (country === "all" || t.country === country) && (!q || [t.role, t.city, ...t.skills].some((s) => s.toLowerCase().includes(q)))
  );
  return (
    <>
      <Header title="Find talent" />
      <PageBody>
        <div className="flex flex-wrap items-center gap-3">
          <Input className="max-w-sm" placeholder="Skill, role or city" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search talent" />
          <ToggleGroup type="single" variant="outline" value={country} onValueChange={(v) => v && setCountry(v as typeof country)} aria-label="Country">
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="PH">Philippines</ToggleGroupItem>
            <ToggleGroupItem value="US">United States</ToggleGroupItem>
          </ToggleGroup>
          <span className="text-sm text-muted-foreground">{list.length} people</span>
        </div>
        <p className="text-xs text-muted-foreground">Names show after a person accepts your interview request. Overlap is with your workday in Pacific time.</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => {
            const saved = shortlist.includes(t.id);
            return (
              <Card key={t.id} className="gap-3 py-4" data-talent={t.id}>
                <CardHeader className="px-4">
                  <CardTitle className="text-base">{t.role}</CardTitle>
                  <CardDescription>
                    {t.id} · {t.city}, {flag(t.country)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 px-4 text-sm">
                  <div className="flex flex-wrap gap-1.5">
                    {t.skills.map((s) => (
                      <Badge key={s} variant="secondary">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Rate</dt>
                      <dd className="font-medium">${t.rate}/h</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Overlap</dt>
                      <dd className="font-medium">{t.overlap} h</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Starts</dt>
                      <dd className="font-medium">{t.available}</dd>
                    </div>
                  </dl>
                </CardContent>
                <CardFooter className="gap-2 px-4">
                  <Button size="sm" variant={saved ? "secondary" : "outline"} onClick={() => toggleShortlist(t.id)} aria-pressed={saved}>
                    <Icon name="star" /> {saved ? "Shortlisted" : "Shortlist"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled title="Mockup">
                    Ask for interview
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </PageBody>
    </>
  );
}

export function ShortlistPage() {
  const { shortlist, toggleShortlist } = useOrbytt();
  const list = TALENT.filter((t) => shortlist.includes(t.id));
  return (
    <>
      <Header title="Shortlist" />
      <PageBody>
        <SimpleTable
          empty="Your shortlist is empty. Find talent and select Shortlist."
          head={["Talent", "Role", "Location", "Rate", ""]}
          rows={list.map((t) => [
            t.id,
            t.role,
            `${t.city}, ${flag(t.country)}`,
            `$${t.rate}/h`,
            <Button size="sm" variant="ghost" onClick={() => toggleShortlist(t.id)}>
              Remove
            </Button>
          ])}
        />
      </PageBody>
    </>
  );
}

export function InterviewsPage() {
  return (
    <>
      <Header title="Interviews" />
      <PageBody>
        <SimpleTable
          empty="No interviews yet."
          head={["Talent", "Role", "When", "Status"]}
          rows={INTERVIEWS.map((i) => [i.talentId, i.role, i.when, <Badge variant={i.status === "Accepted" ? "default" : "outline"}>{i.status}</Badge>])}
        />
      </PageBody>
    </>
  );
}

export function ContractorsPage() {
  return (
    <>
      <Header title="Contractors" />
      <PageBody>
        <p className="text-sm text-muted-foreground">People you hired through Orbytt. Each one is a company guest on their projects until the end date.</p>
        <SimpleTable
          empty="No contractors yet."
          head={["Name", "Role", "Projects", "Project role", "Ends"]}
          rows={CONTRACTORS.map((c) => [c.name, c.role, c.projects.join(", "), c.projectRole, c.ends])}
        />
      </PageBody>
    </>
  );
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            {head.map((h, i) => (
              <TableHead key={i}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {r.map((cell, j) => (
                <TableCell key={j}>{cell}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
