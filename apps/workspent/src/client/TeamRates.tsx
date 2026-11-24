import { useState, type FormEvent } from "react";
import { Field, Modal, Notice, api, errorText } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@openact/ui/components/card";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@openact/ui/components/table";
import { MEMBER_KINDS, hoursOne, moneyText, type MemberInfo, type MemberKind, type WorkSettings } from "../shared/projects";
import { companyApi, useCompanyData } from "./lib";

/** Team for Projects: each account's kind (staff or freelancer), rate and planned hours. Guests are freelancers by default. */
export function TeamRates() {
  const team = useCompanyData<{ members: MemberInfo[] }>("/team");
  const settings = useCompanyData<WorkSettings>("/settings");
  const [editing, setEditing] = useState<MemberInfo | null>(null);
  const currency = settings.data?.currency ?? "USD";

  return (
    <Card>
      <CardHeader>
        <CardTitle>People on projects</CardTitle>
        <CardDescription>
          Everyone with an account in the company, guests too. A person's rate applies when the project and the client have none. Add people to projects in the Projects app.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {team.error && (
          <Notice tone="error" className="m-4">
            {team.error}
          </Notice>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Rate an hour</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Planned each week</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.data?.members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{m.kind === "freelancer" ? "Freelancer" : "Staff"}</Badge>
                    {m.role === "guest" && <span className="ml-2 text-xs text-muted-foreground">Guest</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m.rateCents === null ? "None" : moneyText(m.rateCents, currency)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{m.weeklyMinutes ? hoursOne(m.weeklyMinutes) : "None"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="xs" variant="ghost" onClick={() => setEditing(m)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      {editing && team.companyId && <RateDialog companyId={team.companyId} member={editing} onClose={() => setEditing(null)} onSaved={team.reload} />}
    </Card>
  );
}

function RateDialog({ companyId, member, onClose, onSaved }: { companyId: string; member: MemberInfo; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<MemberKind>(member.kind);
  const [rate, setRate] = useState(member.rateCents === null ? "" : (member.rateCents / 100).toFixed(2));
  const [weekly, setWeekly] = useState(member.weeklyMinutes ? String(member.weeklyMinutes / 60) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`${companyApi(companyId)}/team/${member.userId}`, {
        method: "PUT",
        body: { kind, rate, weeklyHours: weekly }
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
    <Modal title={member.name} onClose={onClose}>
      <form onSubmit={save} className="grid gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Kind" htmlFor="ws-member-kind">
          <NativeSelect id="ws-member-kind" value={kind} onChange={(e) => setKind(e.target.value as MemberKind)} className="w-full">
            {MEMBER_KINDS.map((k) => (
              <NativeSelectOption key={k} value={k}>
                {k === "freelancer" ? "Freelancer" : "Staff"}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rate an hour" htmlFor="ws-member-rate" help="Empty: no rate of their own.">
            <Input id="ws-member-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="50.00" />
          </Field>
          <Field label="Hours planned each week" htmlFor="ws-member-weekly" help="Shows on their My time.">
            <Input id="ws-member-weekly" inputMode="decimal" value={weekly} onChange={(e) => setWeekly(e.target.value)} placeholder="30" />
          </Field>
        </div>
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
