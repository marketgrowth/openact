import { useCallback, useEffect, useState } from "react";
import { COMPANY_ROLES, COMPANY_ROLE_LABELS, type CompanyAppSettings, type CompanyRole } from "@openact/core/shared";
import { api, errorText } from "../api";
import { Notice, useToast } from "../ui";
import { useWorkspace } from "../workspace";
import { Badge } from "@openact/ui/components/badge";
import { Checkbox } from "@openact/ui/components/checkbox";
import { Switch } from "@openact/ui/components/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@openact/ui/components/table";

/* Company settings: the Apps tab (which apps are on) and the Permissions tab (who can do what in each app). */

export function useCompanyApps(companyId: string) {
  const ws = useWorkspace();
  const toast = useToast();
  const [apps, setApps] = useState<CompanyAppSettings[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setApps((await api<{ apps: CompanyAppSettings[] }>(`/api/companies/${companyId}/apps`)).apps);
    } catch (e) {
      setError(errorText(e));
    }
  }, [companyId]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (appId: string, body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await api(`/api/companies/${companyId}/apps/${appId}`, { method: "PATCH", body });
      await Promise.all([load(), ws.reloadAccess()]);
      toast(done);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { apps, error, busy, save };
}

export function AppsTab({ companyId }: { companyId: string }) {
  const { apps, error, busy, save } = useCompanyApps(companyId);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!apps) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="grid gap-3" data-apps-tab="">
      <p className="text-sm text-muted-foreground">Turn apps on or off for everyone in this company. An app that is off keeps its data, and you can turn it on again later.</p>
      <ul className="grid gap-2">
        {apps.map((a) => (
          <li key={a.id} className="flex items-center gap-3 rounded-lg border p-3" data-app-setting={a.id}>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="font-medium">{a.name}</span>
              <span className="text-xs text-muted-foreground">
                {a.siteOff
                  ? "Off for this site. A super admin can turn it on in Site settings."
                  : `${a.permissions.length} ${a.permissions.length === 1 ? "permission" : "permissions"} · ${a.enabledByDefault ? "On" : "Off"} for new companies`}
              </span>
            </div>
            <Switch
              checked={a.enabled}
              disabled={busy || a.siteOff}
              onCheckedChange={(on) => save(a.id, { enabled: on }, `${a.name} is ${on ? "on" : "off"}.`)}
              aria-label={`${a.name} app`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PermissionsTab({ companyId }: { companyId: string }) {
  const { apps, error, busy, save } = useCompanyApps(companyId);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!apps) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const withPerms = apps.filter((a) => a.permissions.length);
  if (!withPerms.length) return <p className="text-sm text-muted-foreground">The installed apps have no permissions to set.</p>;

  const toggle = (app: CompanyAppSettings, permId: string, current: CompanyRole[], role: CompanyRole, on: boolean) => {
    const roles = on ? [...current, role] : current.filter((r) => r !== role);
    save(app.id, { permissions: { [permId]: roles } }, `Saved. ${COMPANY_ROLE_LABELS[role]}s ${on ? "can now" : "can no longer"} do this.`);
  };

  return (
    <div className="grid gap-5" data-permissions-tab="">
      <p className="text-sm text-muted-foreground">
        Choose what each company role can do in each app. The owner can always do everything. Guests see only what someone shares with them.
      </p>
      {withPerms.map((app) => (
        <section key={app.id} className="grid gap-2" data-permissions-app={app.id}>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {app.name}
            {!app.enabled && <Badge variant="outline">Off</Badge>}
          </h3>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Permission</TableHead>
                  {COMPANY_ROLES.map((r) => (
                    <TableHead key={r} className="w-16 text-center">
                      {COMPANY_ROLE_LABELS[r]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {app.permissions.map((p) => (
                  <TableRow key={p.id} data-permission={p.id}>
                    <TableCell className="whitespace-normal">
                      <div className="font-medium">{p.label}</div>
                      {p.description && <div className="text-xs text-muted-foreground">{p.description}</div>}
                    </TableCell>
                    {COMPANY_ROLES.map((r) => {
                      const fixed = p.locked.includes(r) || !p.allowed.includes(r);
                      return (
                        <TableCell key={r} className="text-center">
                          <Checkbox
                            checked={p.current.includes(r)}
                            disabled={busy || fixed}
                            onCheckedChange={(v) => toggle(app, p.id, p.current, r, v === true)}
                            aria-label={`${COMPANY_ROLE_LABELS[r]}: ${p.label}`}
                            title={p.locked.includes(r) ? "Always on for this role" : !p.allowed.includes(r) ? "Not available for guests" : undefined}
                            data-role={r}
                          />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ))}
    </div>
  );
}
