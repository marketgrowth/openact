import { useState, type FormEvent } from "react";
import { Field, Icon, Modal, Notice, PageBody, SiteHeader, api, errorText } from "@openact/ui";
import { Progress } from "@openact/ui/arc/progress";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@openact/ui/components/card";
import { Checkbox } from "@openact/ui/components/checkbox";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@openact/ui/components/table";
import { BUDGET_WARN, hoursOne, moneyText, type ClientInfo, type ProjectInfo, type WorkSettings } from "../shared/projects";
import { companyApi, useCompanyData, useMe } from "./lib";

/** Clients and projects: who the work is for, each project's client, rate and budget. Projects come from the Projects app. */
export default function ClientsPage() {
  const me = useMe();
  const canSetup = !!me.data?.canSetup;
  const clients = useCompanyData<{ clients: ClientInfo[] }>(canSetup ? "/clients" : null);
  const projects = useCompanyData<{
    projects: ProjectInfo[];
    projectsApp: boolean;
  }>(canSetup ? "/projects" : null);
  const settings = useCompanyData<WorkSettings>(canSetup ? "/settings" : null);
  const [editClient, setEditClient] = useState<ClientInfo | "new" | null>(null);
  const [editProject, setEditProject] = useState<ProjectInfo | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const currency = settings.data?.currency ?? "USD";
  const list = clients.data?.clients ?? [];
  const shown = list.filter((c) => showArchived || !c.isArchived);
  const companyId = clients.companyId;
  const rate = (cents: number | null) => (cents === null ? "None" : moneyText(cents, currency));
  const clientName = (id: string | null) => (id ? (list.find((c) => c.id === id)?.name ?? "") : "");

  return (
    <>
      <SiteHeader title="Clients and projects" />
      <PageBody className="max-w-5xl">
        {me.data && !canSetup && <Notice tone="info">Only company owners and admins set up clients and projects.</Notice>}
        {(clients.error || projects.error) && <Notice tone="error">{clients.error ?? projects.error}</Notice>}
        <p className="text-sm text-muted-foreground">Projects come from the Projects app. Link each project to a client, and set a rate and a budget in hours.</p>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div className="grid gap-1.5">
              <CardTitle>Clients</CardTitle>
              <CardDescription>A client with an approver email approves their hours from a link. Without one, a manager approves them.</CardDescription>
            </div>
            <Button onClick={() => setEditClient("new")} disabled={!canSetup}>
              <Icon name="plus" />
              Add client
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Approves weeks</TableHead>
                    <TableHead className="text-right">Rate an hour</TableHead>
                    <TableHead className="text-right">Projects</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!shown.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        No clients yet. Add the first one.
                      </TableCell>
                    </TableRow>
                  )}
                  {shown.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        {c.name} {c.isArchived && <Badge variant="outline">Archived</Badge>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.approverEmail ? [c.approverName, c.approverEmail].filter(Boolean).join(", ") : "A manager approves"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{rate(c.rateCents)}</TableCell>
                      <TableCell className="text-right tabular-nums">{(projects.data?.projects ?? []).filter((p) => p.clientId === c.id).length}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setEditClient(c)}>
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {list.some((c) => c.isArchived) && (
              <label className="flex items-center gap-2 p-4 text-sm">
                <Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(v === true)} />
                Show archived clients
              </label>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Projects</CardTitle>
            <CardDescription>The rate comes from the project, then the client, then the person. A person sees only the projects they can see in the Projects app.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {projects.data && !projects.data.projectsApp && (
              <Notice tone="info" className="m-4">
                Turn on the Projects app in Company settings to track time on projects.
              </Notice>
            )}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Rate an hour</TableHead>
                    <TableHead className="min-w-48">Budget used</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.data?.projects.map((p) => {
                    const share = p.budgetMinutes ? p.usedMinutes / p.budgetMinutes : 0;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-muted-foreground">{clientName(p.clientId) || "No client"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {!p.isTracked ? "Not tracked" : !p.isBillable ? "Not billable" : p.rateCents !== null ? rate(p.rateCents) : "Client rate"}
                        </TableCell>
                        <TableCell>
                          {p.budgetMinutes ? (
                            <div className="grid gap-1">
                              <span className="flex justify-between text-xs">
                                <span>
                                  {hoursOne(p.usedMinutes)} of {hoursOne(p.budgetMinutes)}
                                </span>
                                <span className={share >= BUDGET_WARN ? "font-medium text-priority-high" : undefined}>{Math.round(share * 100)}%</span>
                              </span>
                              <Progress value={Math.min(p.usedMinutes, p.budgetMinutes)} max={p.budgetMinutes} aria-label={`Budget used for ${p.name}`} />
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">No budget</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setEditProject(p)}>
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </PageBody>

      {editClient && companyId && (
        <ClientDialog
          companyId={companyId}
          client={editClient === "new" ? null : editClient}
          onClose={() => setEditClient(null)}
          onSaved={() => (clients.reload(), projects.reload())}
        />
      )}
      {editProject && companyId && (
        <ProjectDialog
          companyId={companyId}
          project={editProject}
          clients={list.filter((c) => !c.isArchived || c.id === editProject.clientId)}
          onClose={() => setEditProject(null)}
          onSaved={projects.reload}
        />
      )}
    </>
  );
}

const centsText = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));

function ClientDialog({ companyId, client, onClose, onSaved }: { companyId: string; client: ClientInfo | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(client?.name ?? "");
  const [approverName, setApproverName] = useState(client?.approverName ?? "");
  const [approverEmail, setApproverEmail] = useState(client?.approverEmail ?? "");
  const [rate, setRate] = useState(centsText(client?.rateCents ?? null));
  const [archived, setArchived] = useState(client?.isArchived ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name,
        approverName,
        approverEmail,
        rate,
        isArchived: archived
      };
      if (client)
        await api(`${companyApi(companyId)}/clients/${client.id}`, {
          method: "PATCH",
          body
        });
      else await api(`${companyApi(companyId)}/clients`, { method: "POST", body });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={client ? `Edit ${client.name}` : "Add a client"} onClose={onClose}>
      <form onSubmit={save} className="grid gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Name" htmlFor="ws-client-name">
          <Input id="ws-client-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Approver name" htmlFor="ws-client-approver">
            <Input id="ws-client-approver" value={approverName} onChange={(e) => setApproverName(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Approver email" htmlFor="ws-client-email" help="Leave it empty when a manager approves.">
            <Input id="ws-client-email" type="email" value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} />
          </Field>
        </div>
        <Field label="Rate an hour" htmlFor="ws-client-rate" help="Leave it empty to use each person's rate.">
          <Input id="ws-client-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="75.00" className="max-w-40" />
        </Field>
        {client && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={archived} onCheckedChange={(v) => setArchived(v === true)} />
            Archived: hide this client from new work
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectDialog({
  companyId,
  project,
  clients,
  onClose,
  onSaved
}: {
  companyId: string;
  project: ProjectInfo;
  clients: ClientInfo[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState(project.clientId ?? "");
  const [rate, setRate] = useState(centsText(project.rateCents));
  const [budget, setBudget] = useState(project.budgetMinutes ? String(project.budgetMinutes / 60) : "");
  const [billable, setBillable] = useState(project.isBillable);
  const [tracked, setTracked] = useState(project.isTracked);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`${companyApi(companyId)}/projects/${project.id}`, {
        method: "PUT",
        body: {
          clientId: clientId || null,
          rate,
          budgetHours: budget,
          isBillable: billable,
          isTracked: tracked
        }
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={project.name} description="Hours that no one approved yet move with the project to its new client." onClose={onClose}>
      <form onSubmit={save} className="grid gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Client" htmlFor="ws-project-client">
          <NativeSelect id="ws-project-client" value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full">
            <NativeSelectOption value="">No client</NativeSelectOption>
            {clients.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rate an hour" htmlFor="ws-project-rate" help="Empty: the client's rate.">
            <Input id="ws-project-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="90.00" />
          </Field>
          <Field label="Budget in hours" htmlFor="ws-project-budget" help="Empty: no budget.">
            <Input id="ws-project-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="60" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={billable} onCheckedChange={(v) => setBillable(v === true)} />
          Billable
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={tracked} onCheckedChange={(v) => setTracked(v === true)} />
          Track time on this project
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
