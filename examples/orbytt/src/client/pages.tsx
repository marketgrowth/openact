import { useEffect, useState, type ReactNode } from "react";
import { Avatar, CompanyMark, Field, Icon, Link, Modal, PageBody, SiteHeader, api, useShell, useToast, useWorkspace } from "@openact/ui";
import { Checkbox } from "@openact/ui/components/checkbox";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@openact/ui/components/card";
import { Input } from "@openact/ui/components/input";
import { Label } from "@openact/ui/components/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@openact/ui/components/table";
import { ToggleGroup, ToggleGroupItem } from "@openact/ui/components/toggle-group";
import { ACTIVITY, CONTRACTORS, INTERVIEWS, TALENT, matchScore, type Talent } from "./data";
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
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3">
              {ACTIVITY.map((a) => (
                <li key={a.text} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Icon name={a.icon} size={14} />
                  </span>
                  <span className="min-w-0 flex-1">{a.text}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{a.when}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="text-base">Find your next hire</CardTitle>
            <CardDescription>Vetted remote talent in the US and the Philippines, ready to join your projects.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild className="w-full">
              <Link to="/a/orbytt/talent">
                <Icon name="talent" /> Find talent
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </>
  );
}

/** The talent's photo stays hidden until they accept an interview. */
function Anon({ size = 40 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" style={{ width: size, height: size }}>
      <Icon name="users" size={Math.round(size * 0.45)} />
    </span>
  );
}

function Overlap({ hours }: { hours: number }) {
  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Overlap with your workday</span>
        <span className="font-medium text-foreground">{hours} of 8 h</span>
      </div>
      <div className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i < hours ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>
    </div>
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
                <CardHeader className="flex flex-row items-center gap-3 px-4">
                  <Anon />
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <CardTitle className="text-base">{t.role}</CardTitle>
                    <CardDescription className="truncate">
                      {t.id} · {t.city}, {t.country}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {matchScore(t, query)}% match
                  </Badge>
                </CardHeader>
                <CardContent className="grid gap-3 px-4 text-sm">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline">
                      <Icon name="check" size={12} /> Vetted
                    </Badge>
                    {t.skills.map((s) => (
                      <Badge key={s} variant="secondary">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  <Overlap hours={t.overlap} />
                  <dl className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Rate</dt>
                      <dd className="font-medium">${t.rate}/h</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Experience</dt>
                      <dd className="font-medium">{t.years} years</dd>
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
                  <Button size="sm" variant="ghost" title="Mockup">
                    <Icon name="video" /> Ask for interview
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
  const [hiring, setHiring] = useState<Talent | null>(null);
  const list = TALENT.filter((t) => shortlist.includes(t.id));
  return (
    <>
      <Header title="Shortlist" />
      <PageBody>
        {!list.length && <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Your shortlist is empty. Find talent and select Shortlist.</p>}
        <div className="grid gap-3">
          {list.map((t) => (
            <Card key={t.id} className="flex-row flex-wrap items-center gap-4 px-4 py-3">
              <Anon />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-medium">{t.role}</span>
                <span className="text-xs text-muted-foreground">
                  {t.id} · {t.city}, {flag(t.country)} · ${t.rate}/h · {t.overlap} h overlap
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => toggleShortlist(t.id)}>
                  Remove
                </Button>
                <Button size="sm" variant="outline">
                  <Icon name="video" /> Ask for interview
                </Button>
                <Button size="sm" onClick={() => setHiring(t)}>
                  <Icon name="briefcase" /> Hire
                </Button>
              </div>
            </Card>
          ))}
        </div>
        {hiring && <HireDialog talent={hiring} onClose={() => setHiring(null)} />}
      </PageBody>
    </>
  );
}

/** The hire step: Orbytt sends the offer, and the talent joins the chosen projects as a company guest when they accept. */
function HireDialog({ talent, onClose }: { talent: Talent; onClose: () => void }) {
  const { current } = useWorkspace();
  const toast = useToast();
  const [projects, setProjects] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    if (!current) return;
    api<{ projects: Array<{ id: string; name: string; color: string }> }>(`/api/projects?company=${current.id}`)
      .then((r) => {
        setProjects(r.projects);
        setPicked(r.projects.slice(0, 1).map((p) => p.id));
      })
      .catch(() => setProjects([]));
  }, [current]);
  return (
    <Modal
      title={`Hire ${talent.id} as a contractor`}
      description="Orbytt sends the offer and the contract. When the talent accepts, they join your company as a guest on the projects you pick, until the end date."
      onClose={onClose}
      wide
    >
      <div className="grid gap-4">
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <Anon size={36} />
          <div className="grid min-w-0 flex-1 text-sm">
            <span className="font-medium">{talent.role}</span>
            <span className="text-xs text-muted-foreground">
              {talent.city}, {flag(talent.country)} · {talent.skills.join(", ")}
            </span>
          </div>
        </div>
        <Field label="Projects">
          <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2" data-hire-projects="">
            {projects.map((p) => (
              <Label key={p.id} className="flex items-center gap-2 text-sm font-normal">
                <Checkbox checked={picked.includes(p.id)} onCheckedChange={(v) => setPicked((s) => (v ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                <span className="size-2.5 rounded-full" style={{ background: `var(--pc-${p.color})` }} />
                {p.name}
              </Label>
            ))}
            {!projects.length && <span className="text-sm text-muted-foreground">No projects yet.</span>}
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Project role" htmlFor="hire-role">
            <NativeSelect id="hire-role" defaultValue="editor" className="w-full">
              <NativeSelectOption value="viewer">Viewer</NativeSelectOption>
              <NativeSelectOption value="editor">Editor</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field label="Start" htmlFor="hire-start">
            <Input id="hire-start" type="date" defaultValue="2026-11-16" />
          </Field>
          <Field label="End" htmlFor="hire-end">
            <Input id="hire-end" type="date" defaultValue="2027-02-28" />
          </Field>
          <Field label="Rate per hour" htmlFor="hire-rate">
            <Input id="hire-rate" type="number" defaultValue={talent.rate} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">Orbytt handles the contract and payments. The contractor sees only the projects you pick.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              toast("Mockup: no offer was sent.");
              onClose();
            }}
          >
            Send offer
          </Button>
        </div>
      </div>
    </Modal>
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
        <div className="grid gap-4 md:grid-cols-2">
          {CONTRACTORS.map((c) => (
            <Card key={c.name} className="gap-3 py-4">
              <CardHeader className="flex flex-row items-center gap-3 px-4">
                <Avatar id={c.name} name={c.name} size={40} />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <CardDescription className="truncate">
                    {c.role} · {c.city}
                  </CardDescription>
                </div>
                <Badge variant="outline">Guest until {c.ends}</Badge>
              </CardHeader>
              <CardContent className="grid gap-3 px-4 text-sm">
                <div className="flex flex-wrap gap-1.5">
                  {c.projects.map((p) => (
                    <Badge key={p} variant="secondary">
                      {p} · {c.projectRole}
                    </Badge>
                  ))}
                </div>
                <div className="grid gap-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>This week</span>
                    <span className="font-medium text-foreground">
                      {c.hours} of 40 h · ${c.hours * c.rate}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(c.hours / 40) * 100}%` }} />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="gap-2 px-4">
                <Button size="sm" variant="outline">
                  Extend
                </Button>
                <Button size="sm" variant="ghost">
                  End engagement
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
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
