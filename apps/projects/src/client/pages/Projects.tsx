import { useState, type ReactNode } from "react";
import {
  COMPANY_ROLE_LABELS,
  PROJECT_COLORS,
  ROLE_LABELS,
  VISIBILITIES,
  VISIBILITY_HELP,
  VISIBILITY_LABELS,
  type Company,
  type ProjectColor,
  type User,
  type Visibility
} from "../../shared/types";
import { useCan, useShell, useWorkspace } from "@openact/ui";
import { useProjects } from "../projects-context";
import { api, errorText } from "@openact/ui";
import { Link, navigate } from "@openact/ui";
import { Field, Icon, Modal, Notice, useToast } from "@openact/ui";
import { PageBody, SiteHeader } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Textarea } from "@openact/ui/components/textarea";
import { Badge } from "@openact/ui/components/badge";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@openact/ui/components/card";
import { cn } from "@openact/ui/lib/utils";

export function ProjectsPage() {
  const ws = useWorkspace();
  const shell = useShell();
  const { projects, newProject: onNewProject } = useProjects();
  const me = shell.me!;
  const onNewCompany = () => shell.open("newCompany");
  const current = ws.current;

  if (ws.companies && !ws.companies.length) {
    return (
      <>
        <SiteHeader title="Welcome" />
        <PageBody>
          <EmptyState
            title="Create your company"
            text="Every project belongs to a company. Make one for your team, then add projects and invite people. Anyone you invite to one project joins as a guest and sees only that project."
          >
            <Button onClick={onNewCompany}>
              <Icon name="plus" /> Create a company
            </Button>
          </EmptyState>
        </PageBody>
      </>
    );
  }

  const canCreate = useCan("projects.create");
  const totals = (projects ?? []).reduce((t, p) => ({ tasks: t.tasks + p.taskCount, done: t.done + p.doneCount, late: t.late + p.lateCount }), {
    tasks: 0,
    done: 0,
    late: 0
  });
  const donePct = totals.tasks ? Math.round((totals.done / totals.tasks) * 100) : 0;
  return (
    <>
      <SiteHeader title={current ? current.name : "Projects"}>
        {canCreate && (
          <Button size="sm" onClick={onNewProject}>
            <Icon name="plus" /> <span className="hidden sm:inline">New project</span>
          </Button>
        )}
      </SiteHeader>
      <PageBody>
        <div className="grid gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">Hello {me.name || me.email}</h2>
          {current && (
            <p className="text-sm text-muted-foreground">
              You are {/^[aeiou]/i.test(COMPANY_ROLE_LABELS[current.role]) ? "an" : "a"} {COMPANY_ROLE_LABELS[current.role].toLowerCase()} in this company.
            </p>
          )}
        </div>

        {projects && projects.length > 0 && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Summary">
            <StatCard label="Projects" value={projects.length} />
            <StatCard label="Tasks" value={totals.tasks} />
            <StatCard label="Done" value={`${donePct}%`} />
            <StatCard label="Late" value={totals.late} tone={totals.late > 0 ? "late" : undefined} />
          </div>
        )}

        {!projects && <p className="text-sm text-muted-foreground">Loading your projects…</p>}
        {projects && !projects.length && (
          <EmptyState
            title="No projects yet"
            text={
              canCreate
                ? "Make a project. Then invite your team. There is no limit on people."
                : "You are a guest in this company. You see a project here when someone invites you to it."
            }
          >
            {canCreate && <Button onClick={onNewProject}>Make your first project</Button>}
          </EmptyState>
        )}
        {projects && projects.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Projects">
            {projects.map((p) => {
              const pct = p.taskCount ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
              return (
                <li key={p.id} className="min-w-0">
                  <Link
                    to={`/p/${p.id}`}
                    className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    data-project-card=""
                  >
                    <Card className="h-full gap-4 bg-gradient-to-t from-primary/5 to-card py-5 shadow-xs transition-colors group-hover:border-foreground/20 dark:bg-card">
                      <CardHeader className="px-5">
                        <CardDescription className="flex items-center gap-2">
                          <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--pc-${p.color})` }} aria-hidden="true" />
                          <span className="tabular">
                            {p.taskCount} {p.taskCount === 1 ? "task" : "tasks"} · {p.memberCount} {p.memberCount === 1 ? "person" : "people"}
                          </span>
                        </CardDescription>
                        <CardTitle className="flex min-w-0 items-center gap-2 text-lg font-semibold">
                          <span className="truncate">{p.name}</span>
                          {p.visibility === "secret" && (
                            <span className="shrink-0 text-muted-foreground" title="Secret project">
                              <Icon name="shield" size={14} />
                              <span className="sr-only">Secret</span>
                            </span>
                          )}
                        </CardTitle>
                        <CardAction>
                          <Badge variant="outline">{p.isMember ? ROLE_LABELS[p.role] : `${ROLE_LABELS[p.role]} via company`}</Badge>
                        </CardAction>
                      </CardHeader>
                      <CardFooter className="mt-auto flex-col items-stretch gap-2 px-5 text-sm">
                        {p.description && <p className="line-clamp-2 text-muted-foreground">{p.description}</p>}
                        <div
                          className="h-1.5 overflow-hidden rounded-full bg-muted"
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${pct}% done`}
                        >
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `var(--pc-${p.color})` }} />
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="tabular">{pct}% done</span>
                          {p.lateCount > 0 && <span className="tabular font-medium text-priority-high">{p.lateCount} late</span>}
                        </div>
                      </CardFooter>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PageBody>
    </>
  );
}

function StatCard({ label, value, tone }: { label: string; value: ReactNode; tone?: "late" }) {
  return (
    <Card className="gap-1 bg-gradient-to-t from-primary/5 to-card py-4 shadow-xs dark:bg-card">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn("tabular text-2xl font-semibold", tone === "late" && "text-priority-high")}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

/** A centered message for an empty page, with an optional action. */
export function EmptyState({ title, text, children, className }: { title: string; text: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto flex w-full max-w-lg flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center", className)} data-empty="">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{text}</p>
      {children && <div className="mt-2 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export function NewProjectDialog({ company, onClose }: { company: Company; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<ProjectColor>("indigo");
  const [template, setTemplate] = useState<"blank" | "example">("blank");
  const [visibility, setVisibility] = useState<Visibility>("company");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>("/api/projects", { body: { name, description, color, template, visibility, companyId: company.id } });
      toast("Project created.");
      navigate(`/p/${r.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`New project in ${company.name}`} onClose={onClose}>
      <form className="grid gap-5" onSubmit={create}>
        <Field label="Name" htmlFor="np-name">
          <Input id="np-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Website relaunch" />
        </Field>
        <Field label="Description" htmlFor="np-desc">
          <Textarea
            id="np-desc"
            rows={2}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional. One or two sentences about the goal."
          />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Color</legend>
          <div className="flex flex-wrap gap-2">
            {PROJECT_COLORS.map((c) => (
              <label
                key={c}
                title={c}
                className="relative size-7 cursor-pointer rounded-full ring-offset-2 ring-offset-background has-[:checked]:ring-2 has-[:checked]:ring-ring has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                style={{ background: `var(--pc-${c})` }}
              >
                <input type="radio" name="np-color" value={c} checked={color === c} onChange={() => setColor(c)} className="sr-only" />
                <span className="sr-only">{c}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <ChoiceGroup
          legend="Start with"
          name="np-template"
          value={template}
          onChange={(v) => setTemplate(v as "blank" | "example")}
          options={[
            ["blank", "A blank project", "Add your own tasks, or draft them with AI."],
            ["example", "An example plan", "Ten sample tasks for a website relaunch. Edit or delete them."]
          ]}
        />
        <ChoiceGroup
          legend="Who can see it"
          name="np-visibility"
          value={visibility}
          onChange={(v) => setVisibility(v as Visibility)}
          options={VISIBILITIES.map((v) => [v, VISIBILITY_LABELS[v], VISIBILITY_HELP[v]])}
        />
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            Create project
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** A set of radio choices shown as bordered rows with a title and help text. */
export function ChoiceGroup({
  legend,
  name,
  value,
  onChange,
  options
}: {
  legend: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string, string]>;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      {options.map(([v, title, help]) => (
        <label
          key={v}
          className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50 has-[:checked]:border-primary has-[:checked]:bg-accent/50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
        >
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} className="mt-0.5 size-4 accent-primary" />
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">{title}</span>
            <span className="text-xs text-muted-foreground">{help}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
