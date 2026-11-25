import assert from "node:assert/strict";
import type { Case } from "../harness/cases.ts";
import type { Side } from "../harness/companies.ts";
import type { Deploy } from "../harness/deploy.ts";

/*
 * WorkSpent. Alpha has a location, a person with a PIN, a time clock device, clock-ins, a manager fix and an approved period.
 * Beta has its own location and device, so the cases can also send Alpha ids through Beta's own company and device.
 */

const API = "/api/apps/workspent";
const installed = (d: Deploy) => d.app.routes.some((r) => r.path === `${API}/companies/:id/me`);

type Ids = {
  locationId: string;
  personId: string;
  deviceId: string;
  deviceKey: string;
  punchId: string;
  changeId: string;
  periodStart: string;
  betaLocationId: string;
  betaDeviceKey: string;
  shiftId: string;
  clientId: string;
  projectId: string;
  entryId: string;
  week: string;
};
const ids: Ids = {
  locationId: "00000000-0000-4000-8000-000000000001",
  personId: "00000000-0000-4000-8000-000000000002",
  deviceId: "00000000-0000-4000-8000-000000000003",
  deviceKey: "none",
  punchId: "00000000-0000-4000-8000-000000000004",
  changeId: "00000000-0000-4000-8000-000000000005",
  periodStart: "2026-01-04",
  betaLocationId: "00000000-0000-4000-8000-000000000006",
  betaDeviceKey: "none",
  shiftId: "00000000-0000-4000-8000-000000000007",
  clientId: "00000000-0000-4000-8000-000000000008",
  projectId: "00000000-0000-4000-8000-000000000009",
  entryId: "00000000-0000-4000-8000-00000000000a",
  week: "2026-01-04"
};
const ALPHA_PIN = "4826";

async function ok(d: Deploy, who: Side["owner"], method: string, path: string, body?: unknown) {
  const r = await d.call(who, method, path, body);
  assert.ok(r.status >= 200 && r.status < 300, `${method} ${path}: ${r.status} ${r.text}`);
  return r.json ?? {};
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const sundayBefore = (date: string) => {
  const t = Date.parse(date + "T00:00:00Z");
  return new Date(t - new Date(t).getUTCDay() * 86_400_000).toISOString().slice(0, 10);
};

async function setUp(d: Deploy, side: Side, word: string) {
  const c = `${API}/companies/${side.companyId}`;
  await ok(d, side.owner, "PATCH", `/api/companies/${side.companyId}/apps/workspent`, { enabled: true });
  // Weekly periods from the Sunday two weeks ago, so last week's period has ended.
  const start = sundayBefore(day(-14));
  const loc = (await ok(d, side.owner, "POST", `${c}/locations`, { name: `${word} Home`, timeZone: "UTC", periodKind: "weekly", periodStartDate: start })) as {
    location: { id: string };
  };
  const person = (await ok(d, side.owner, "POST", `${c}/people`, { name: `${word} Staff`, locationIds: [loc.location.id], pin: ALPHA_PIN })) as {
    person: { id: string };
  };
  const dev = (await ok(d, side.owner, "POST", `${c}/locations/${loc.location.id}/devices`, { name: `${word} Tablet`, kind: "tablet" })) as {
    device: { id: string };
    key: string;
  };
  return { c, start, locationId: loc.location.id, personId: person.person.id, deviceId: dev.device.id, deviceKey: dev.key };
}

export async function seed(d: Deploy, alpha: Side, beta: Side): Promise<void> {
  if (!installed(d)) return;
  const a = await setUp(d, alpha, "ALPHASECRET");
  const b = await setUp(d, beta, "Beta");
  // A clock-in on Alpha's device.
  const punch = await d.call(null, "POST", `${API}/device/punch`, { pin: ALPHA_PIN, kind: "in" }, { "x-workspent-device": a.deviceKey });
  assert.equal(punch.status, 201, punch.text);
  // A whole shift last week, added by a manager. Then approve last week's period.
  const lastWeek = sundayBefore(day(-7));
  await ok(d, alpha.owner, "POST", `${a.c}/locations/${a.locationId}/shifts`, {
    personId: a.personId,
    date: lastWeek,
    inTime: "08:00",
    outTime: "12:00",
    reason: "ALPHASECRET forgot the PIN"
  });
  const prev = sundayBefore(day(-7));
  await ok(d, alpha.owner, "POST", `${a.c}/locations/${a.locationId}/periods/${prev}/approve`);
  // A member of Alpha who is linked to the person, so My time has data.
  await ok(d, alpha.owner, "PATCH", `${a.c}/people/${a.personId}`, { userId: alpha.member.id });
  // A published shift next week.
  const shift = (await ok(d, alpha.owner, "POST", `${a.c}/locations/${a.locationId}/schedule`, {
    personId: a.personId,
    date: sundayBefore(day(8)),
    startTime: "07:00",
    endTime: "15:30",
    note: "ALPHASECRET med pass"
  })) as { ids: string[] };
  await ok(d, alpha.owner, "POST", `${a.c}/locations/${a.locationId}/schedule/publish`, { from: sundayBefore(day(8)), to: sundayBefore(day(8)) });
  // Projects: a client, a project with a rate, an entry with a note, and a sent week.
  const client = (await ok(d, alpha.owner, "POST", `${a.c}/clients`, { name: "ALPHASECRET Client", approverEmail: "approver@alpha.test", rate: 75 })) as {
    client: { id: string };
  };
  // A deploy without the Projects app has no project. The Projects cases then use the planted ids and stay denied.
  const project = d.all<{ id: string }>("SELECT id FROM projects WHERE company_id = ? ORDER BY created_at LIMIT 1", alpha.companyId)[0];
  const entryDay = day(-7);
  let entryId = ids.entryId;
  if (project) {
    await ok(d, alpha.owner, "PUT", `${a.c}/projects/${project.id}`, { clientId: client.client.id, budgetHours: 10 });
    const entry = (await ok(d, alpha.owner, "POST", `${a.c}/entries`, { projectId: project.id, date: entryDay, minutes: 90, note: "ALPHASECRET work" })) as {
      entry: { id: string };
    };
    entryId = entry.entry.id;
    await ok(d, alpha.owner, "POST", `${a.c}/weeks/${entryDay}/send`);
  }
  const p = d.one<{ id: string }>("SELECT id FROM workspent_punches WHERE company_id = ? AND source = 'device'", alpha.companyId);
  const ch = d.one<{ id: string }>("SELECT id FROM workspent_changes WHERE company_id = ? LIMIT 1", alpha.companyId);
  Object.assign(ids, {
    locationId: a.locationId,
    personId: a.personId,
    deviceId: a.deviceId,
    deviceKey: a.deviceKey,
    punchId: p.id,
    changeId: ch.id,
    periodStart: prev,
    betaLocationId: b.locationId,
    betaDeviceKey: b.deviceKey,
    shiftId: shift.ids[0],
    clientId: client.client.id,
    projectId: project?.id ?? ids.projectId,
    entryId,
    week: sundayBefore(entryDay)
  });
}

export function snapshot(d: Deploy, alpha: Side): string {
  if (!installed(d)) return "";
  const tables = [
    ...["workspent_settings", "workspent_clients", "workspent_projects", "workspent_members", "workspent_entries", "workspent_weeks"],
    ...["workspent_shifts", "workspent_locations", "workspent_people", "workspent_person_locations", "workspent_devices", "workspent_punches", "workspent_changes"],
    ...["workspent_periods", "workspent_location_managers"]
  ];
  return tables.map((t) => JSON.stringify(d.all(`SELECT * FROM ${t} WHERE company_id = ? ORDER BY 1, 2`, alpha.companyId))).join("\n");
}

const A = (a: Side) => `${API}/companies/${a.companyId}`;
const B = (b: Side) => `${API}/companies/${b.companyId}`;
const dev = (key: () => string) => ({ get "x-workspent-device"() {
  return key();
} });

export const cases: Case[] = [
  // The time clock device: no device key, Alpha's PIN on Beta's own device, and a planted id.
  { route: "GET /api/apps/workspent/device", path: () => `${API}/device`, who: "none", expect: "denied" },
  { route: "GET /api/apps/workspent/device", path: () => `${API}/device`, who: "none", headers: { "x-workspent-device": `${"00000000-0000-4000-8000-000000000003"}.forgedforgedforgedforged` }, expect: "denied", why: "A forged key." },
  { route: "POST /api/apps/workspent/device/pin", path: () => `${API}/device/pin`, who: "none", body: () => ({ pin: ALPHA_PIN }), expect: "denied" },
  {
    route: "POST /api/apps/workspent/device/pin",
    path: () => `${API}/device/pin`,
    who: "none",
    body: () => ({ pin: "9999" }),
    headers: dev(() => ids.betaDeviceKey) as Record<string, string>,
    expect: "denied",
    why: "Beta's own device. A PIN finds only Beta people."
  },
  { route: "POST /api/apps/workspent/device/punch", path: () => `${API}/device/punch`, who: "none", body: () => ({ pin: ALPHA_PIN, kind: "out" }), expect: "denied" },
  {
    route: "POST /api/apps/workspent/device/punch",
    path: () => `${API}/device/punch`,
    who: "none",
    body: () => ({ pin: "9998", kind: "out" }),
    headers: dev(() => ids.betaDeviceKey) as Record<string, string>,
    expect: "denied",
    why: "Beta's own device cannot clock out an Alpha person."
  },
  {
    route: "POST /api/apps/workspent/device/sync",
    path: () => `${API}/device/sync`,
    who: "none",
    body: () => ({ punches: [{ id: ids.punchId, pin: ALPHA_PIN, kind: "out", at: new Date().toISOString() }] }),
    expect: "denied"
  },
  {
    route: "POST /api/apps/workspent/device/sync",
    path: () => `${API}/device/sync`,
    who: "none",
    body: () => ({ punches: [{ id: ids.punchId, pin: "9997", kind: "out", at: new Date().toISOString() }] }),
    headers: dev(() => ids.betaDeviceKey) as Record<string, string>,
    expect: "any",
    why: "Beta's own device may send. An Alpha punch id is refused as in use, and Alpha's rows do not change."
  },

  // Alpha's company, called by Beta's owner and member.
  { route: "GET /api/apps/workspent/companies/:id/me", path: (a) => `${A(a)}/me`, expect: "denied" },
  { route: "GET /api/apps/workspent/companies/:id/me", path: (a) => `${A(a)}/me`, who: "betaMember", expect: "denied" },
  { route: "GET /api/apps/workspent/companies/:id/members", path: (a) => `${A(a)}/members`, expect: "denied" },
  { route: "GET /api/apps/workspent/companies/:id/locations", path: (a) => `${A(a)}/locations`, expect: "denied" },
  {
    route: "POST /api/apps/workspent/companies/:id/locations",
    path: (a) => `${A(a)}/locations`,
    body: () => ({ name: "Planted", timeZone: "UTC", periodKind: "weekly", periodStartDate: "2026-01-04" }),
    expect: "denied"
  },
  { route: "PATCH /api/apps/workspent/companies/:id/locations/:lid", path: (a) => `${A(a)}/locations/${ids.locationId}`, body: () => ({ name: "Taken" }), expect: "denied" },
  {
    route: "PATCH /api/apps/workspent/companies/:id/locations/:lid",
    path: (_a, b) => `${B(b)}/locations/${ids.locationId}`,
    body: () => ({ name: "Taken" }),
    expect: "denied",
    why: "Beta's company with an Alpha location."
  },
  { route: "PUT /api/apps/workspent/companies/:id/locations/:lid/managers", path: (a) => `${A(a)}/locations/${ids.locationId}/managers`, body: (_a, b) => ({ userIds: [b.owner.id] }), expect: "denied" },
  {
    route: "PUT /api/apps/workspent/companies/:id/locations/:lid/managers",
    path: (_a, b) => `${B(b)}/locations/${ids.betaLocationId}/managers`,
    body: (a) => ({ userIds: [a.owner.id] }),
    expect: "denied",
    why: "An Alpha person cannot become a Beta manager."
  },
  { route: "GET /api/apps/workspent/companies/:id/locations/:lid/devices", path: (a) => `${A(a)}/locations/${ids.locationId}/devices`, expect: "denied" },
  { route: "GET /api/apps/workspent/companies/:id/locations/:lid/devices", path: (_a, b) => `${B(b)}/locations/${ids.locationId}/devices`, expect: "denied", why: "Beta's company with an Alpha location." },
  { route: "POST /api/apps/workspent/companies/:id/locations/:lid/devices", path: (a) => `${A(a)}/locations/${ids.locationId}/devices`, body: () => ({ name: "Planted", kind: "tablet" }), expect: "denied" },
  {
    route: "POST /api/apps/workspent/companies/:id/locations/:lid/devices",
    path: (_a, b) => `${B(b)}/locations/${ids.locationId}/devices`,
    body: () => ({ name: "Planted", kind: "tablet" }),
    expect: "denied",
    why: "Beta's company with an Alpha location."
  },
  { route: "POST /api/apps/workspent/companies/:id/devices/:did/off", path: (a) => `${A(a)}/devices/${ids.deviceId}/off`, expect: "denied" },
  { route: "POST /api/apps/workspent/companies/:id/devices/:did/off", path: (_a, b) => `${B(b)}/devices/${ids.deviceId}/off`, expect: "denied", why: "Beta's company with an Alpha device." },
  { route: "POST /api/apps/workspent/companies/:id/devices/:did/unlock", path: (a) => `${A(a)}/devices/${ids.deviceId}/unlock`, expect: "denied" },
  { route: "POST /api/apps/workspent/companies/:id/devices/:did/unlock", path: (_a, b) => `${B(b)}/devices/${ids.deviceId}/unlock`, expect: "denied", why: "Beta's company with an Alpha device." },
  { route: "GET /api/apps/workspent/companies/:id/people", path: (a) => `${A(a)}/people`, expect: "denied" },
  { route: "POST /api/apps/workspent/companies/:id/people", path: (a) => `${A(a)}/people`, body: () => ({ name: "Planted", locationIds: [ids.locationId] }), expect: "denied" },
  {
    route: "POST /api/apps/workspent/companies/:id/people",
    path: (_a, b) => `${B(b)}/people`,
    body: () => ({ name: "Planted", locationIds: [ids.locationId] }),
    expect: "denied",
    why: "Beta's company with an Alpha location."
  },
  {
    route: "POST /api/apps/workspent/companies/:id/people",
    path: (_a, b) => `${B(b)}/people`,
    body: (a) => ({ name: "Planted", locationIds: [], userId: a.member.id }),
    expect: "denied",
    why: "Beta's company with an Alpha account."
  },
  { route: "PATCH /api/apps/workspent/companies/:id/people/:pid", path: (a) => `${A(a)}/people/${ids.personId}`, body: () => ({ name: "Taken" }), expect: "denied" },
  { route: "PATCH /api/apps/workspent/companies/:id/people/:pid", path: (_a, b) => `${B(b)}/people/${ids.personId}`, body: () => ({ isActive: false }), expect: "denied", why: "Beta's company with an Alpha person." },
  { route: "POST /api/apps/workspent/companies/:id/people/:pid/pin", path: (a) => `${A(a)}/people/${ids.personId}/pin`, body: () => ({}), expect: "denied" },
  { route: "POST /api/apps/workspent/companies/:id/people/:pid/pin", path: (_a, b) => `${B(b)}/people/${ids.personId}/pin`, body: () => ({}), expect: "denied", why: "Beta's company with an Alpha person." },
  { route: "GET /api/apps/workspent/companies/:id/locations/:lid/timesheet", path: (a) => `${A(a)}/locations/${ids.locationId}/timesheet`, expect: "denied" },
  { route: "GET /api/apps/workspent/companies/:id/locations/:lid/timesheet", path: (_a, b) => `${B(b)}/locations/${ids.locationId}/timesheet`, expect: "denied", why: "Beta's company with an Alpha location." },
  { route: "GET /api/apps/workspent/companies/:id/locations/:lid/people/:pid", path: (a) => `${A(a)}/locations/${ids.locationId}/people/${ids.personId}`, expect: "denied" },
  {
    route: "GET /api/apps/workspent/companies/:id/locations/:lid/people/:pid",
    path: (_a, b) => `${B(b)}/locations/${ids.betaLocationId}/people/${ids.personId}`,
    expect: "denied",
    why: "Beta's own location with an Alpha person."
  },
  {
    route: "POST /api/apps/workspent/companies/:id/locations/:lid/punches",
    path: (a) => `${A(a)}/locations/${ids.locationId}/punches`,
    body: () => ({ personId: ids.personId, kind: "out", reason: "Planted" }),
    expect: "denied"
  },
  {
    route: "POST /api/apps/workspent/companies/:id/locations/:lid/punches",
    path: (_a, b) => `${B(b)}/locations/${ids.betaLocationId}/punches`,
    body: () => ({ personId: ids.personId, kind: "out", reason: "Planted" }),
    expect: "denied",
    why: "Beta's own location with an Alpha person."
  },
  {
    route: "POST /api/apps/workspent/companies/:id/locations/:lid/shifts",
    path: (a) => `${A(a)}/locations/${ids.locationId}/shifts`,
    body: () => ({ personId: ids.personId, date: "2026-01-05", inTime: "08:00", outTime: "09:00", reason: "Planted" }),
    expect: "denied"
  },
  {
    route: "POST /api/apps/workspent/companies/:id/locations/:lid/shifts",
    path: (_a, b) => `${B(b)}/locations/${ids.betaLocationId}/shifts`,
    body: () => ({ personId: ids.personId, date: "2026-01-05", inTime: "08:00", outTime: "09:00", reason: "Planted" }),
    expect: "denied",
    why: "Beta's own location with an Alpha person."
  },
  { route: "PATCH /api/apps/workspent/companies/:id/punches/:pid", path: (a) => `${A(a)}/punches/${ids.punchId}`, body: () => ({ date: "2026-01-05", time: "08:00", reason: "Planted" }), expect: "denied" },
  {
    route: "PATCH /api/apps/workspent/companies/:id/punches/:pid",
    path: (_a, b) => `${B(b)}/punches/${ids.punchId}`,
    body: () => ({ date: "2026-01-05", time: "08:00", reason: "Planted" }),
    expect: "denied",
    why: "Beta's company with an Alpha punch."
  },
  { route: "DELETE /api/apps/workspent/companies/:id/punches/:pid", path: (a) => `${A(a)}/punches/${ids.punchId}`, body: () => ({ reason: "Planted" }), expect: "denied" },
  { route: "DELETE /api/apps/workspent/companies/:id/punches/:pid", path: (_a, b) => `${B(b)}/punches/${ids.punchId}`, body: () => ({ reason: "Planted" }), expect: "denied", why: "Beta's company with an Alpha punch." },
  { route: "POST /api/apps/workspent/companies/:id/locations/:lid/periods/:start/approve", path: (a) => `${A(a)}/locations/${ids.locationId}/periods/${ids.periodStart}/approve`, expect: "denied" },
  {
    route: "POST /api/apps/workspent/companies/:id/locations/:lid/periods/:start/approve",
    path: (_a, b) => `${B(b)}/locations/${ids.locationId}/periods/${ids.periodStart}/approve`,
    expect: "denied",
    why: "Beta's company with an Alpha location."
  },
  { route: "POST /api/apps/workspent/companies/:id/locations/:lid/periods/:start/reopen", path: (a) => `${A(a)}/locations/${ids.locationId}/periods/${ids.periodStart}/reopen`, expect: "denied" },
  {
    route: "POST /api/apps/workspent/companies/:id/locations/:lid/periods/:start/reopen",
    path: (_a, b) => `${B(b)}/locations/${ids.locationId}/periods/${ids.periodStart}/reopen`,
    expect: "denied",
    why: "Beta's company with an Alpha location."
  },
  { route: "GET /api/apps/workspent/companies/:id/locations/:lid/periods/:start/export", path: (a) => `${A(a)}/locations/${ids.locationId}/periods/${ids.periodStart}/export`, expect: "denied" },
  {
    route: "GET /api/apps/workspent/companies/:id/locations/:lid/periods/:start/export",
    path: (_a, b) => `${B(b)}/locations/${ids.locationId}/periods/${ids.periodStart}/export`,
    expect: "denied",
    why: "Beta's company with an Alpha location."
  },
  { route: "GET /api/apps/workspent/companies/:id/my-time", path: (a) => `${A(a)}/my-time`, expect: "denied" },
  { route: "GET /api/apps/workspent/companies/:id/my-time", path: (_a, b) => `${B(b)}/my-time`, expect: "any", why: "Beta's own My time must hold no Alpha hours." },
  // Schedules.
  { route: "GET /api/apps/workspent/companies/:id/locations/:lid/schedule", path: (a) => `${A(a)}/locations/${ids.locationId}/schedule?from=2026-01-04&to=2026-01-10`, expect: "denied" },
  {
    route: "GET /api/apps/workspent/companies/:id/locations/:lid/schedule",
    path: (_a, b) => `${B(b)}/locations/${ids.locationId}/schedule?from=2026-01-04&to=2026-01-10`,
    expect: "denied",
    why: "Beta's company with an Alpha location."
  },
  {
    route: "POST /api/apps/workspent/companies/:id/locations/:lid/schedule",
    path: (a) => `${A(a)}/locations/${ids.locationId}/schedule`,
    body: () => ({ personId: ids.personId, date: "2030-01-07", startTime: "07:00", endTime: "15:00" }),
    expect: "denied"
  },
  {
    route: "POST /api/apps/workspent/companies/:id/locations/:lid/schedule",
    path: (_a, b) => `${B(b)}/locations/${ids.betaLocationId}/schedule`,
    body: () => ({ personId: ids.personId, date: "2030-01-07", startTime: "07:00", endTime: "15:00" }),
    expect: "denied",
    why: "Beta's own location with an Alpha person."
  },
  { route: "PATCH /api/apps/workspent/companies/:id/schedule/:sid", path: (a) => `${A(a)}/schedule/${ids.shiftId}`, body: () => ({ note: "Taken" }), expect: "denied" },
  { route: "PATCH /api/apps/workspent/companies/:id/schedule/:sid", path: (_a, b) => `${B(b)}/schedule/${ids.shiftId}`, body: () => ({ note: "Taken" }), expect: "denied", why: "Beta's company with an Alpha shift." },
  { route: "DELETE /api/apps/workspent/companies/:id/schedule/:sid", path: (a) => `${A(a)}/schedule/${ids.shiftId}`, expect: "denied" },
  { route: "DELETE /api/apps/workspent/companies/:id/schedule/:sid", path: (_a, b) => `${B(b)}/schedule/${ids.shiftId}`, expect: "denied", why: "Beta's company with an Alpha shift." },
  {
    route: "POST /api/apps/workspent/companies/:id/locations/:lid/schedule/publish",
    path: (a) => `${A(a)}/locations/${ids.locationId}/schedule/publish`,
    body: () => ({ from: "2026-01-04", to: "2026-01-10" }),
    expect: "denied"
  },
  {
    route: "POST /api/apps/workspent/companies/:id/locations/:lid/schedule/publish",
    path: (_a, b) => `${B(b)}/locations/${ids.locationId}/schedule/publish`,
    body: () => ({ from: "2026-01-04", to: "2026-01-10" }),
    expect: "denied",
    why: "Beta's company with an Alpha location."
  },
  { route: "POST /api/apps/workspent/companies/:id/locations/:lid/schedule/copy", path: (a) => `${A(a)}/locations/${ids.locationId}/schedule/copy`, body: () => ({ weekStart: "2030-01-06" }), expect: "denied" },
  {
    route: "POST /api/apps/workspent/companies/:id/locations/:lid/schedule/copy",
    path: (_a, b) => `${B(b)}/locations/${ids.locationId}/schedule/copy`,
    body: () => ({ weekStart: "2030-01-06" }),
    expect: "denied",
    why: "Beta's company with an Alpha location."
  },
  // Projects.
  { route: "GET /api/apps/workspent/companies/:id/settings", path: (a) => `${A(a)}/settings`, expect: "denied" },
  { route: "PUT /api/apps/workspent/companies/:id/settings", path: (a) => `${A(a)}/settings`, body: () => ({ projects: false, shifts: true }), expect: "denied" },
  { route: "PUT /api/apps/workspent/companies/:id/site-kinds", path: (a) => `${A(a)}/site-kinds`, body: () => ({ projects: false, shifts: true }), expect: "denied" },
  {
    route: "PUT /api/apps/workspent/companies/:id/site-kinds",
    path: (_a, b) => `${B(b)}/site-kinds`,
    body: () => ({ projects: false, shifts: true }),
    expect: "denied",
    why: "Beta's owner is not the site owner."
  },
  { route: "GET /api/apps/workspent/companies/:id/clients", path: (a) => `${A(a)}/clients`, expect: "denied" },
  { route: "POST /api/apps/workspent/companies/:id/clients", path: (a) => `${A(a)}/clients`, body: () => ({ name: "Planted" }), expect: "denied" },
  { route: "PATCH /api/apps/workspent/companies/:id/clients/:cid", path: (a) => `${A(a)}/clients/${ids.clientId}`, body: () => ({ name: "Taken" }), expect: "denied" },
  { route: "PATCH /api/apps/workspent/companies/:id/clients/:cid", path: (_a, b) => `${B(b)}/clients/${ids.clientId}`, body: () => ({ name: "Taken" }), expect: "denied", why: "Beta's company with an Alpha client." },
  { route: "GET /api/apps/workspent/companies/:id/projects", path: (a) => `${A(a)}/projects`, expect: "denied" },
  { route: "GET /api/apps/workspent/companies/:id/projects", path: (_a, b) => `${B(b)}/projects`, expect: "any", why: "Beta's own list must hold no Alpha project." },
  { route: "PUT /api/apps/workspent/companies/:id/projects/:pid", path: (a) => `${A(a)}/projects/${ids.projectId}`, body: () => ({ rate: 1 }), expect: "denied" },
  { route: "PUT /api/apps/workspent/companies/:id/projects/:pid", path: (_a, b) => `${B(b)}/projects/${ids.projectId}`, body: () => ({ rate: 1 }), expect: "denied", why: "Beta's company with an Alpha project." },
  { route: "GET /api/apps/workspent/companies/:id/projects/:pid/tasks", path: (a) => `${A(a)}/projects/${ids.projectId}/tasks`, expect: "denied" },
  { route: "GET /api/apps/workspent/companies/:id/projects/:pid/tasks", path: (_a, b) => `${B(b)}/projects/${ids.projectId}/tasks`, expect: "denied", why: "Beta's company with an Alpha project." },
  { route: "GET /api/apps/workspent/companies/:id/team", path: (a) => `${A(a)}/team`, expect: "denied" },
  { route: "PUT /api/apps/workspent/companies/:id/team/:uid", path: (a) => `${A(a)}/team/${a.member.id}`, body: () => ({ kind: "staff", rate: 1 }), expect: "denied" },
  { route: "PUT /api/apps/workspent/companies/:id/team/:uid", path: (a, b) => `${B(b)}/team/${a.member.id}`, body: () => ({ kind: "staff", rate: 1 }), expect: "denied", why: "Beta's company with an Alpha account." },
  { route: "GET /api/apps/workspent/companies/:id/my-projects", path: (a) => `${A(a)}/my-projects?week=2026-01-04`, expect: "denied" },
  { route: "POST /api/apps/workspent/companies/:id/entries", path: (a) => `${A(a)}/entries`, body: () => ({ projectId: ids.projectId, date: "2026-01-05", minutes: 10 }), expect: "denied" },
  {
    route: "POST /api/apps/workspent/companies/:id/entries",
    path: (_a, b) => `${B(b)}/entries`,
    body: () => ({ projectId: ids.projectId, date: "2026-01-05", minutes: 10 }),
    expect: "denied",
    why: "Beta's company with an Alpha project."
  },
  { route: "PATCH /api/apps/workspent/companies/:id/entries/:eid", path: (a) => `${A(a)}/entries/${ids.entryId}`, body: () => ({ minutes: 1 }), expect: "denied" },
  { route: "PATCH /api/apps/workspent/companies/:id/entries/:eid", path: (_a, b) => `${B(b)}/entries/${ids.entryId}`, body: () => ({ minutes: 1 }), expect: "denied", why: "Beta's company with an Alpha entry." },
  { route: "DELETE /api/apps/workspent/companies/:id/entries/:eid", path: (a) => `${A(a)}/entries/${ids.entryId}`, expect: "denied" },
  { route: "DELETE /api/apps/workspent/companies/:id/entries/:eid", path: (_a, b) => `${B(b)}/entries/${ids.entryId}`, expect: "denied", why: "Beta's company with an Alpha entry." },
  { route: "POST /api/apps/workspent/companies/:id/timer/start", path: (a) => `${A(a)}/timer/start`, body: () => ({ projectId: ids.projectId, date: "2026-01-05" }), expect: "denied" },
  {
    route: "POST /api/apps/workspent/companies/:id/timer/start",
    path: (_a, b) => `${B(b)}/timer/start`,
    body: () => ({ projectId: ids.projectId, date: "2026-01-05" }),
    expect: "denied",
    why: "Beta's company with an Alpha project."
  },
  { route: "POST /api/apps/workspent/companies/:id/timer/stop", path: (a) => `${A(a)}/timer/stop`, expect: "denied" },
  { route: "GET /api/apps/workspent/companies/:id/time-log", path: (a) => `${A(a)}/time-log?week=${ids.week}`, expect: "denied" },
  {
    route: "GET /api/apps/workspent/companies/:id/time-log",
    path: (a, b) => `${B(b)}/time-log?week=${ids.week}&userId=${a.owner.id}`,
    expect: "denied",
    why: "Beta's company with an Alpha account."
  },
  { route: "POST /api/apps/workspent/companies/:id/weeks/:week/send", path: (a) => `${A(a)}/weeks/${ids.week}/send`, expect: "denied" },
  {
    route: "POST /api/apps/workspent/companies/:id/weeks/:week/decide",
    path: (a) => `${A(a)}/weeks/${ids.week}/decide`,
    body: (a) => ({ userId: a.owner.id, clientId: ids.clientId, action: "approve" }),
    expect: "denied"
  },
  {
    route: "POST /api/apps/workspent/companies/:id/weeks/:week/decide",
    path: (_a, b) => `${B(b)}/weeks/${ids.week}/decide`,
    body: (a) => ({ userId: a.owner.id, clientId: ids.clientId, action: "approve" }),
    expect: "denied",
    why: "Beta's company with an Alpha week."
  },
  { route: "POST /api/apps/workspent/companies/:id/weeks/:week/link", path: (a) => `${A(a)}/weeks/${ids.week}/link`, body: (a) => ({ userId: a.owner.id, clientId: ids.clientId }), expect: "denied" },
  {
    route: "POST /api/apps/workspent/companies/:id/weeks/:week/link",
    path: (_a, b) => `${B(b)}/weeks/${ids.week}/link`,
    body: (a) => ({ userId: a.owner.id, clientId: ids.clientId }),
    expect: "denied",
    why: "Beta's company with an Alpha week and client."
  },
  { route: "POST /api/apps/workspent/companies/:id/weeks/:week/reopen", path: (a) => `${A(a)}/weeks/${ids.week}/reopen`, body: (a) => ({ userId: a.owner.id, clientId: ids.clientId }), expect: "denied" },
  {
    route: "POST /api/apps/workspent/companies/:id/weeks/:week/reopen",
    path: (_a, b) => `${B(b)}/weeks/${ids.week}/reopen`,
    body: (a) => ({ userId: a.owner.id, clientId: ids.clientId }),
    expect: "denied",
    why: "Beta's company with an Alpha week."
  },
  { route: "GET /api/apps/workspent/companies/:id/reports", path: (a) => `${A(a)}/reports?from=2026-01-01&to=2026-12-31`, expect: "denied" },
  {
    route: "GET /api/apps/workspent/companies/:id/reports",
    path: (a, b) => `${B(b)}/reports?from=2026-01-01&to=2026-12-31&userId=${a.owner.id}`,
    expect: "any",
    why: "Beta's report must hold no Alpha hours."
  },
  { route: "GET /api/apps/workspent/companies/:id/reports/export", path: (a) => `${A(a)}/reports/export?from=2026-01-01&to=2026-12-31`, expect: "denied" },
  {
    route: "GET /api/apps/workspent/companies/:id/reports/export",
    path: (a, b) => `${B(b)}/reports/export?from=2026-01-01&to=2026-12-31&userId=${a.owner.id}`,
    expect: "any",
    why: "Beta's export must hold no Alpha hours."
  },
  { route: "POST /api/apps/workspent/approve/view", path: () => `${API}/approve/view`, who: "none", body: () => ({ token: "forgedforgedforgedforgedforgedforged" }), expect: "denied" },
  {
    route: "POST /api/apps/workspent/approve/decide",
    path: () => `${API}/approve/decide`,
    who: "none",
    body: () => ({ token: "forgedforgedforgedforgedforgedforged", action: "approve" }),
    expect: "denied"
  },
  { route: "POST /api/apps/workspent/companies/:id/changes/:cid/respond", path: (a) => `${A(a)}/changes/${ids.changeId}/respond`, body: () => ({ response: "questioned" }), expect: "denied" },
  {
    route: "POST /api/apps/workspent/companies/:id/changes/:cid/respond",
    path: (_a, b) => `${B(b)}/changes/${ids.changeId}/respond`,
    body: () => ({ response: "questioned" }),
    expect: "denied",
    why: "Beta's company with an Alpha fix."
  }
];
