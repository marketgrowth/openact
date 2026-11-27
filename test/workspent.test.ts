import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDeploy, type Person } from "./harness/deploy.ts";
import { appService } from "../packages/core/src/server/apps.ts";
import type { WorkSpentSync } from "../apps/workspent/src/server/index.ts";

/*
 * WorkSpent routes, on a whole deploy in memory: the time clock device, manager fixes with the audit trail,
 * location managers, approval, the CSV export, My time and the service for other apps.
 */

const API = "/api/apps/workspent";
const DEV = "x-workspent-device";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const sundayBefore = (date: string) => {
  const t = Date.parse(date + "T00:00:00Z");
  return new Date(t - new Date(t).getUTCDay() * 86_400_000).toISOString().slice(0, 10);
};

async function world() {
  const d = makeDeploy();
  const owner = d.person("owner@care.test", "Olive Owner");
  const member = d.person("member@care.test", "Mae Member");
  const other = d.person("house@care.test", "Hal House");
  const call = async (who: Person | null, method: string, path: string, body?: unknown, headers?: Record<string, string>) => d.call(who, method, path, body, headers);
  const ok = async (who: Person | null, method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
    const r = await call(who, method, path, body, headers);
    assert.ok(r.status >= 200 && r.status < 300, `${method} ${path}: ${r.status} ${r.text}`);
    return r.json as Record<string, any>;
  };
  await ok(owner, "POST", "/api/companies", { name: "Sunrise Care" });
  const companyId = d.one<{ id: string }>("SELECT company_id AS id FROM company_members WHERE user_id = ?", owner.id).id;
  await d.join(owner, companyId, member);
  await d.join(owner, companyId, other);
  const c = `${API}/companies/${companyId}`;
  return { d, owner, member, other, companyId, c, call, ok };
}

async function withLocation() {
  const w = await world();
  await w.ok(w.owner, "PATCH", `/api/companies/${w.companyId}/apps/workspent`, { enabled: true });
  const start = sundayBefore(day(-14));
  const loc = (await w.ok(w.owner, "POST", `${w.c}/locations`, { name: "Oak Lane Home", timeZone: "UTC", periodKind: "weekly", periodStartDate: start })).location;
  const ben = (await w.ok(w.owner, "POST", `${w.c}/people`, { name: "Ben T.", locationIds: [loc.id], pin: "1234" })).person;
  const dev = await w.ok(w.owner, "POST", `${w.c}/locations/${loc.id}/devices`, { name: "Front office", kind: "tablet" });
  const key = dev.key as string;
  return { ...w, loc, ben, key, deviceId: dev.device.id as string, start };
}

test("WorkSpent is off until a company turns it on", async () => {
  const w = await world();
  const r = await w.call(w.owner, "GET", `${w.c}/me`);
  assert.equal(r.status, 403);
  assert.match(r.text, /off for this company/);
  await w.ok(w.owner, "PATCH", `/api/companies/${w.companyId}/apps/workspent`, { enabled: true });
  const me = await w.ok(w.owner, "GET", `${w.c}/me`);
  assert.deepEqual(me, { canSetup: true, canManageAll: true, managedLocationIds: [], personId: null, canClock: true, canTrack: true, projects: true, shifts: true });
  const m = await w.ok(w.member, "GET", `${w.c}/me`);
  assert.equal(m.canSetup, false);
  assert.equal(m.canManageAll, false);
});

test("a person clocks in, takes a break and clocks out on the device with a PIN", async () => {
  const w = await withLocation();
  const h = { [DEV]: w.key };
  const hello = await w.ok(null, "GET", `${API}/device`, undefined, h);
  assert.equal(hello.location.name, "Oak Lane Home");
  const who = await w.ok(null, "POST", `${API}/device/pin`, { pin: "1234" }, h);
  assert.deepEqual(who, { person: { name: "Ben T." }, state: "out", since: null, kinds: ["in"] });
  await w.ok(null, "POST", `${API}/device/punch`, { pin: "1234", kind: "in" }, h);
  // The wrong button for the state is refused.
  const twice = await w.call(null, "POST", `${API}/device/punch`, { pin: "1234", kind: "in" }, h);
  assert.equal(twice.status, 409);
  assert.match(twice.text, /already clocked in/);
  assert.deepEqual((await w.ok(null, "POST", `${API}/device/pin`, { pin: "1234" }, h)).kinds, ["break_start", "out"]);
  await w.ok(null, "POST", `${API}/device/punch`, { pin: "1234", kind: "break_start" }, h);
  assert.deepEqual((await w.ok(null, "POST", `${API}/device/pin`, { pin: "1234" }, h)).kinds, ["break_end", "out"]);
  await w.ok(null, "POST", `${API}/device/punch`, { pin: "1234", kind: "break_end" }, h);
  await w.ok(null, "POST", `${API}/device/punch`, { pin: "1234", kind: "out" }, h);
  const rows = w.d.all<{ kind: string; source: string }>("SELECT kind, source FROM workspent_punches ORDER BY punched_at, rowid");
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["in", "break_start", "break_end", "out"]
  );
  assert.ok(rows.every((r) => r.source === "device"));
  // The PIN is stored as a hash only.
  const stored = w.d.one<{ pin_hash: string }>("SELECT pin_hash FROM workspent_people WHERE id = ?", w.ben.id).pin_hash;
  assert.ok(!stored.includes("1234") && stored.length === 64);
  // The device reported in.
  const dev = (await w.ok(w.owner, "GET", `${w.c}/locations/${w.loc.id}/devices`)).devices[0];
  assert.equal(dev.online, true);
});

test("five wrong PINs lock the PIN pad, and a manager unlocks it", async () => {
  const w = await withLocation();
  const h = { [DEV]: w.key };
  for (let i = 0; i < 5; i++) {
    const r = await w.call(null, "POST", `${API}/device/pin`, { pin: "0000" }, h);
    assert.equal(r.status, 403, r.text);
  }
  const locked = await w.call(null, "POST", `${API}/device/pin`, { pin: "1234" }, h);
  assert.equal(locked.status, 423);
  assert.match(locked.text, /locked/);
  const devs = (await w.ok(w.owner, "GET", `${w.c}/locations/${w.loc.id}/devices`)).devices;
  assert.ok(devs[0].lockedUntil);
  await w.ok(w.owner, "POST", `${w.c}/devices/${w.deviceId}/unlock`);
  await w.ok(null, "POST", `${API}/device/pin`, { pin: "1234" }, h);
});

test("a switched-off device stops at once, and a forged key never works", async () => {
  const w = await withLocation();
  const forged = await w.call(null, "GET", `${API}/device`, undefined, { [DEV]: `${w.deviceId}.not-the-real-secret-value` });
  assert.equal(forged.status, 401);
  await w.ok(w.owner, "POST", `${w.c}/devices/${w.deviceId}/off`);
  const r = await w.call(null, "POST", `${API}/device/pin`, { pin: "1234" }, { [DEV]: w.key });
  assert.equal(r.status, 401);
  assert.match(r.text, /not a time clock/);
  assert.equal(w.d.one<{ key_hash: string }>("SELECT key_hash FROM workspent_devices WHERE id = ?", w.deviceId).key_hash, "");
});

test("clock-ins saved offline are sent late, flagged, and never added twice", async () => {
  const w = await withLocation();
  const h = { [DEV]: w.key };
  const at = new Date(Date.now() - 10 * 60_000).toISOString();
  const q = { id: crypto.randomUUID(), pin: "1234", kind: "in", at };
  const wrong = { id: crypto.randomUUID(), pin: "9999", kind: "out", at };
  const r1 = await w.ok(null, "POST", `${API}/device/sync`, { punches: [q, wrong] }, h);
  assert.deepEqual(r1.saved, [q.id]);
  assert.equal(r1.rejected[0].id, wrong.id);
  const r2 = await w.ok(null, "POST", `${API}/device/sync`, { punches: [q] }, h);
  assert.deepEqual(r2.saved, [q.id]);
  assert.equal(w.d.one<{ n: number }>("SELECT COUNT(*) AS n FROM workspent_punches").n, 1);
  const p = w.d.one<{ punched_at: string; is_late_sync: number }>("SELECT punched_at, is_late_sync FROM workspent_punches");
  assert.equal(p.punched_at, at);
  assert.equal(p.is_late_sync, 1);
  const sheet = await w.ok(w.owner, "GET", `${w.c}/locations/${w.loc.id}/timesheet`);
  assert.equal(sheet.onClock.length, 1);
  assert.ok(sheet.rows[0].sheet.shifts[0].flags.includes("late_sync"));
});

test("manager fixes keep the original, need a reason, and the person can question them", async () => {
  const w = await withLocation();
  await w.ok(w.owner, "PATCH", `${w.c}/people/${w.ben.id}`, { userId: w.member.id });
  const yesterday = day(-1);
  const noReason = await w.call(w.owner, "POST", `${w.c}/locations/${w.loc.id}/punches`, { personId: w.ben.id, kind: "in", date: yesterday, time: "06:55" });
  assert.equal(noReason.status, 400);
  await w.ok(w.owner, "POST", `${w.c}/locations/${w.loc.id}/punches`, { personId: w.ben.id, kind: "in", date: yesterday, time: "06:55", reason: "Tablet was down" });
  const missed = await w.ok(w.owner, "GET", `${w.c}/locations/${w.loc.id}/timesheet`);
  const row = missed.rows.find((r: any) => r.person.id === w.ben.id);
  assert.ok(row.sheet.shifts[0].flags.includes("missed_out"), "no clock-out after 14 hours");
  const out = (await w.ok(w.owner, "POST", `${w.c}/locations/${w.loc.id}/punches`, { personId: w.ben.id, kind: "out", date: yesterday, time: "15:00", reason: "Forgot to clock out" })).id;
  await w.ok(w.owner, "PATCH", `${w.c}/punches/${out}`, { date: yesterday, time: "15:05", reason: "The house log says 3:05 PM" });
  const future = await w.call(w.owner, "PATCH", `${w.c}/punches/${out}`, { date: day(2), time: "15:05", reason: "x" });
  assert.equal(future.status, 400);
  const detail = await w.ok(w.owner, "GET", `${w.c}/locations/${w.loc.id}/people/${w.ben.id}`);
  assert.equal(detail.changes.length, 3);
  const changed = detail.changes.find((c: any) => c.action === "change");
  assert.equal(changed.oldAt.slice(11, 16), "15:00");
  assert.equal(changed.newAt.slice(11, 16), "15:05");
  assert.equal(changed.changedBy, "Olive Owner");
  // The person sees the fixes on My time and questions one.
  const mine = await w.ok(w.member, "GET", `${w.c}/my-time`);
  assert.equal(mine.person.name, "Ben T.");
  assert.equal(mine.changes.length, 3);
  await w.ok(w.member, "POST", `${w.c}/changes/${changed.id}/respond`, { response: "questioned", note: "I left at 3:00" });
  const after = await w.ok(w.owner, "GET", `${w.c}/locations/${w.loc.id}/people/${w.ben.id}`);
  assert.ok(after.sheet.shifts[0].flags.includes("questioned"));
  // Another person cannot answer for Ben.
  const stranger = await w.call(w.other, "POST", `${w.c}/changes/${changed.id}/respond`, { response: "confirmed" });
  assert.equal(stranger.status, 404);
  // A delete crosses the punch out. It stays.
  await w.ok(w.owner, "DELETE", `${w.c}/punches/${out}`, { reason: "Wrong person" });
  assert.equal(w.d.one<{ is_deleted: number }>("SELECT is_deleted FROM workspent_punches WHERE id = ?", out).is_deleted, 1);
});

test("a manager cannot change or approve their own hours", async () => {
  const w = await withLocation();
  await w.ok(w.owner, "PATCH", `${w.c}/people/${w.ben.id}`, { userId: w.owner.id });
  const r = await w.call(w.owner, "POST", `${w.c}/locations/${w.loc.id}/punches`, { personId: w.ben.id, kind: "in", reason: "x" });
  assert.equal(r.status, 403);
  assert.match(r.text, /own hours/);
  // A shift last week, added by another manager, then the owner tries to approve.
  await w.ok(w.owner, "PUT", `${w.c}/locations/${w.loc.id}/managers`, { userIds: [w.other.id] });
  const lastWeek = sundayBefore(day(-7));
  await w.ok(w.other, "POST", `${w.c}/locations/${w.loc.id}/shifts`, { personId: w.ben.id, date: lastWeek, inTime: "08:00", outTime: "12:00", reason: "Paper timesheet" });
  const own = await w.call(w.owner, "POST", `${w.c}/locations/${w.loc.id}/periods/${lastWeek}/approve`);
  assert.equal(own.status, 403);
  await w.ok(w.other, "POST", `${w.c}/locations/${w.loc.id}/periods/${lastWeek}/approve`);
});

test("location managers see and fix only their own locations", async () => {
  const w = await withLocation();
  const loc2 = (await w.ok(w.owner, "POST", `${w.c}/locations`, { name: "Maple Street Home", timeZone: "America/Los_Angeles", periodKind: "biweekly", periodStartDate: w.start })).location;
  await w.ok(w.owner, "PUT", `${w.c}/locations/${w.loc.id}/managers`, { userIds: [w.other.id] });
  const me = await w.ok(w.other, "GET", `${w.c}/me`);
  assert.deepEqual(me.managedLocationIds, [w.loc.id]);
  const list = await w.ok(w.other, "GET", `${w.c}/locations`);
  assert.deepEqual(
    list.locations.map((l: any) => l.id),
    [w.loc.id]
  );
  await w.ok(w.other, "GET", `${w.c}/locations/${w.loc.id}/timesheet`);
  assert.equal((await w.call(w.other, "GET", `${w.c}/locations/${loc2.id}/timesheet`)).status, 403);
  assert.equal((await w.call(w.other, "GET", `${w.c}/people`)).status, 403, "setup only");
  assert.equal((await w.call(w.other, "POST", `${w.c}/locations`, { name: "x", timeZone: "UTC", periodStartDate: w.start })).status, 403);
  // A plain member sees neither.
  assert.equal((await w.call(w.member, "GET", `${w.c}/locations/${w.loc.id}/timesheet`)).status, 403);
  // A guest can never be a location manager.
  const guest = w.d.person("guest@care.test");
  // Guests join through a project. Add the row directly.
  w.d.db.prepare("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, 'guest', ?)").run(w.companyId, guest.id, new Date().toISOString());
  assert.equal((await w.call(w.owner, "PUT", `${w.c}/locations/${w.loc.id}/managers`, { userIds: [guest.id] })).status, 404);
});

test("approval locks the period, exports a CSV that matches the timesheet, and an owner reopens it", async () => {
  const w = await withLocation();
  const lastWeek = sundayBefore(day(-7));
  const notYet = await w.call(w.owner, "GET", `${w.c}/locations/${w.loc.id}/periods/${lastWeek}/export`);
  assert.equal(notYet.status, 409);
  await w.ok(w.owner, "POST", `${w.c}/locations/${w.loc.id}/shifts`, {
    personId: w.ben.id,
    date: lastWeek,
    inTime: "06:55",
    outTime: "15:20",
    breakStart: "11:30",
    breakEnd: "12:01",
    reason: "Paper timesheet"
  });
  // A night shift that ends the next day.
  await w.ok(w.owner, "POST", `${w.c}/locations/${w.loc.id}/shifts`, { personId: w.ben.id, date: lastWeek, inTime: "22:00", outTime: "06:00", reason: "Night shift" });
  const current = await w.call(w.owner, "POST", `${w.c}/locations/${w.loc.id}/periods/${sundayBefore(day(0))}/approve`);
  assert.equal(current.status, 409, "the current period has not ended");
  await w.ok(w.owner, "POST", `${w.c}/locations/${w.loc.id}/periods/${lastWeek}/approve`);
  const sheet = await w.ok(w.owner, "GET", `${w.c}/locations/${w.loc.id}/timesheet?start=${lastWeek}`);
  assert.equal(sheet.status, "approved");
  const minutes = sheet.rows[0].sheet.minutes;
  assert.equal(minutes, 8 * 60 + 25 - 31 + 8 * 60);
  // Locked.
  const fix = await w.call(w.owner, "POST", `${w.c}/locations/${w.loc.id}/punches`, { personId: w.ben.id, kind: "in", date: lastWeek, time: "05:00", reason: "x" });
  assert.equal(fix.status, 409);
  assert.match(fix.text, /approved/);
  // The CSV: one row per shift, minutes that add up to the timesheet.
  const csv = await w.call(w.owner, "GET", `${w.c}/locations/${w.loc.id}/periods/${lastWeek}/export`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(csv.headers.get("content-disposition") ?? "", /workspent-oak-lane-home-/);
  const lines = csv.text.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines[0], "Person,Location,Date,Clock in,Clock out,Break minutes,Worked minutes,Hours,Flags,Manager changes");
  assert.equal(lines.length, 3);
  const total = lines.slice(1).reduce((n, l) => n + Number(l.split(",")[6]), 0);
  assert.equal(total, minutes);
  assert.match(lines[1]!, /Ben T\.,Oak Lane Home,.*,31,474,7\.90,/);
  assert.match(lines[1]!, /4 fixes: Paper timesheet/);
  // Only an owner or admin reopens.
  await w.ok(w.owner, "PUT", `${w.c}/locations/${w.loc.id}/managers`, { userIds: [w.other.id] });
  assert.equal((await w.call(w.other, "POST", `${w.c}/locations/${w.loc.id}/periods/${lastWeek}/reopen`)).status, 403);
  await w.ok(w.owner, "POST", `${w.c}/locations/${w.loc.id}/periods/${lastWeek}/reopen`);
  await w.ok(w.owner, "POST", `${w.c}/locations/${w.loc.id}/punches`, { personId: w.ben.id, kind: "in", date: lastWeek, time: "05:00", reason: "Early start" });
});

test("missed clock-ins and clock-outs block approval until they are fixed", async () => {
  const w = await withLocation();
  const lastWeek = sundayBefore(day(-7));
  await w.ok(w.owner, "POST", `${w.c}/locations/${w.loc.id}/punches`, { personId: w.ben.id, kind: "in", date: lastWeek, time: "07:00", reason: "Tablet was down" });
  const r = await w.call(w.owner, "POST", `${w.c}/locations/${w.loc.id}/periods/${lastWeek}/approve`);
  assert.equal(r.status, 409);
  assert.match(r.text, /Fix 1 missed/);
});

test("PINs are unique at a location, and a new PIN shows once", async () => {
  const w = await withLocation();
  const dup = await w.call(w.owner, "POST", `${w.c}/people`, { name: "Carla M.", locationIds: [w.loc.id], pin: "1234" });
  assert.equal(dup.status, 409);
  const carla = await w.ok(w.owner, "POST", `${w.c}/people`, { name: "Carla M.", locationIds: [w.loc.id] });
  assert.match(carla.pin, /^\d{4}$/);
  assert.notEqual(carla.pin, "1234");
  const people = await w.ok(w.owner, "GET", `${w.c}/people`);
  assert.ok(!JSON.stringify(people).includes(carla.pin) || carla.pin === "0000", "the list never holds a PIN");
  const again = await w.ok(w.owner, "POST", `${w.c}/people/${carla.person.id}/pin`, {});
  assert.match(again.pin, /^\d{4}$/);
  // A person who is off cannot clock in.
  await w.ok(w.owner, "PATCH", `${w.c}/people/${w.ben.id}`, { isActive: false });
  assert.equal((await w.call(null, "POST", `${API}/device/pin`, { pin: "1234" }, { [DEV]: w.key })).status, 403);
});

test("removing a member unlinks their person and keeps the hours", async () => {
  const w = await withLocation();
  await w.ok(w.owner, "PATCH", `${w.c}/people/${w.ben.id}`, { userId: w.member.id });
  await w.ok(w.owner, "PUT", `${w.c}/locations/${w.loc.id}/managers`, { userIds: [w.member.id] });
  await w.ok(null, "POST", `${API}/device/punch`, { pin: "1234", kind: "in" }, { [DEV]: w.key });
  await w.ok(w.owner, "DELETE", `/api/companies/${w.companyId}/members/${w.member.id}`);
  assert.equal(w.d.one<{ user_id: string | null }>("SELECT user_id FROM workspent_people WHERE id = ?", w.ben.id).user_id, null);
  assert.equal(w.d.one<{ n: number }>("SELECT COUNT(*) AS n FROM workspent_location_managers").n, 0);
  assert.equal(w.d.one<{ n: number }>("SELECT COUNT(*) AS n FROM workspent_punches").n, 1);
});

test("deleting a company deletes its WorkSpent rows", async () => {
  const w = await withLocation();
  await w.ok(null, "POST", `${API}/device/punch`, { pin: "1234", kind: "in" }, { [DEV]: w.key });
  await w.ok(w.owner, "DELETE", `/api/companies/${w.companyId}`, { confirm: "Sunrise Care" });
  for (const t of ["workspent_locations", "workspent_people", "workspent_devices", "workspent_punches", "workspent_changes"])
    assert.equal(w.d.one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`).n, 0, t);
});

test("other apps add locations and people through the sync service", async () => {
  const w = await world();
  const sync = appService<WorkSpentSync>("workspent", "sync")!;
  assert.ok(sync);
  const env = w.d.env as never;
  const home = await sync.upsertLocation(env, w.companyId, { sourceApp: "directcare", sourceKey: "home-1", name: "Oak Lane Home", timeZone: "America/Los_Angeles" });
  const again = await sync.upsertLocation(env, w.companyId, { sourceApp: "directcare", sourceKey: "home-1", name: "Oak Lane", timeZone: "America/Los_Angeles" });
  assert.equal(home.id, again.id);
  const p = await sync.upsertPerson(env, w.companyId, { sourceApp: "directcare", sourceKey: "staff-9", name: "Ana R.", userId: w.member.id, locationKeys: ["home-1"] });
  const row = w.d.one<{ name: string; user_id: string; pin_hash: string | null }>("SELECT name, user_id, pin_hash FROM workspent_people WHERE id = ?", p.id);
  assert.deepEqual({ ...row }, { name: "Ana R.", user_id: w.member.id, pin_hash: null });
  assert.equal(w.d.one<{ n: number }>("SELECT COUNT(*) AS n FROM workspent_person_locations WHERE person_id = ?", p.id).n, 1);
  await sync.upsertPerson(env, w.companyId, { sourceApp: "directcare", sourceKey: "staff-9", name: "Ana R.", locationKeys: [], isActive: false });
  assert.equal(w.d.one<{ n: number }>("SELECT COUNT(*) AS n FROM workspent_person_locations WHERE person_id = ?", p.id).n, 0);
  await assert.rejects(sync.upsertLocation(env, w.companyId, { sourceApp: "directcare", sourceKey: "x", name: "Bad", timeZone: "Mars/Base" }), /timeZone/);
});
