import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDeploy, type Person } from "./harness/deploy.ts";

/* WorkSpent schedules on a whole deploy in memory: add, repeat, overlap, publish, copy a week, and My time. */

const API = "/api/apps/workspent";
const sundayOf = (offsetWeeks: number) => {
  const now = new Date();
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - now.getUTCDay() * 86_400_000 + offsetWeeks * 7 * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};
const plus = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);

async function world() {
  const d = makeDeploy();
  const owner = d.person("owner@care.test", "Olive Owner");
  const member = d.person("member@care.test", "Mae Member");
  const other = d.person("house@care.test", "Hal House");
  const call = (who: Person | null, method: string, path: string, body?: unknown) => d.call(who, method, path, body);
  const ok = async (who: Person | null, method: string, path: string, body?: unknown) => {
    const r = await call(who, method, path, body);
    assert.ok(r.status >= 200 && r.status < 300, `${method} ${path}: ${r.status} ${r.text}`);
    return r.json as Record<string, any>;
  };
  await ok(owner, "POST", "/api/companies", { name: "Sunrise Care" });
  const companyId = d.one<{ id: string }>("SELECT company_id AS id FROM company_members WHERE user_id = ?", owner.id).id;
  for (const p of [member, other]) await d.join(owner, companyId, p);
  await ok(owner, "PATCH", `/api/companies/${companyId}/apps/workspent`, { enabled: true });
  const c = `${API}/companies/${companyId}`;
  const loc = (await ok(owner, "POST", `${c}/locations`, { name: "Oak Lane Home", timeZone: "America/Los_Angeles", periodKind: "weekly", periodStartDate: sundayOf(-2) })).location;
  const ana = (await ok(owner, "POST", `${c}/people`, { name: "Ana R.", locationIds: [loc.id], userId: member.id })).person;
  const ben = (await ok(owner, "POST", `${c}/people`, { name: "Ben T.", locationIds: [loc.id] })).person;
  const L = `${c}/locations/${loc.id}`;
  return { d, owner, member, other, companyId, c, L, loc, ana, ben, call, ok };
}

const read = (w: Awaited<ReturnType<typeof world>>, from: string, to: string) => w.ok(w.owner, "GET", `${w.L}/schedule?from=${from}&to=${to}`);

test("a manager adds shifts, repeats one weekly, and overlaps are refused", async () => {
  const w = await world();
  const week = sundayOf(1);
  const r = await w.ok(w.owner, "POST", `${w.L}/schedule`, { personId: w.ana.id, date: plus(week, 1), startTime: "07:00", endTime: "15:30", breakMinutes: 30, repeatWeeks: 3 });
  assert.equal(r.ids.length, 4);
  assert.equal(w.d.one<{ n: number }>("SELECT COUNT(DISTINCT series_key) AS n FROM workspent_shifts").n, 1);
  const clash = await w.call(w.owner, "POST", `${w.L}/schedule`, { personId: w.ana.id, date: plus(week, 1), startTime: "15:00", endTime: "23:00" });
  assert.equal(clash.status, 409);
  assert.match(clash.text, /already has a shift/);
  // A night shift ends the next day. A shift that starts at its end touches it and is fine.
  await w.ok(w.owner, "POST", `${w.L}/schedule`, { personId: w.ana.id, date: plus(week, 2), startTime: "23:00", endTime: "07:00" });
  await w.ok(w.owner, "POST", `${w.L}/schedule`, { personId: w.ana.id, date: plus(week, 3), startTime: "07:00", endTime: "15:00" });
  // A repeat that runs into a clash is refused whole.
  const repeatClash = await w.call(w.owner, "POST", `${w.L}/schedule`, { personId: w.ana.id, date: plus(week, -6), startTime: "08:00", endTime: "09:00", repeatWeeks: 2 });
  assert.equal(repeatClash.status, 409);
  assert.equal(w.d.one<{ n: number }>("SELECT COUNT(*) AS n FROM workspent_shifts").n, 6);
  // Bad input.
  assert.equal((await w.call(w.owner, "POST", `${w.L}/schedule`, { personId: w.ben.id, date: plus(week, 1), startTime: "07:00", endTime: "08:00", breakMinutes: 60 })).status, 400);
  assert.equal((await w.call(w.owner, "POST", `${w.L}/schedule`, { personId: w.ben.id, date: "soon", startTime: "07:00", endTime: "08:00" })).status, 400);
  assert.equal((await w.call(w.owner, "POST", `${w.L}/schedule`, { personId: w.ben.id, date: plus(week, 1), startTime: "07:00", endTime: "08:00", repeatWeeks: 50 })).status, 400);
});

test("new and changed shifts stay drafts until a manager publishes, and staff see only published shifts", async () => {
  const w = await world();
  const week = sundayOf(0);
  const tomorrow = plus(new Date().toISOString().slice(0, 10), 1);
  const id = (await w.ok(w.owner, "POST", `${w.L}/schedule`, { personId: w.ana.id, date: tomorrow, startTime: "07:00", endTime: "15:30", breakMinutes: 30, note: "Med pass" })).ids[0];
  await w.ok(w.owner, "POST", `${w.L}/schedule`, { personId: null, date: tomorrow, startTime: "15:00", endTime: "23:30" });
  const from = plus(week, -7);
  const to = plus(week, 13);
  let s = await read(w, from, to);
  assert.deepEqual(s.shifts.map((x: any) => x.status).sort(), ["draft", "draft"]);
  assert.equal(s.unpublished, 2);
  assert.equal((await w.ok(w.member, "GET", `${w.c}/my-time`)).upcoming.length, 0, "a draft is not on My time");
  assert.equal((await w.ok(w.owner, "POST", `${w.L}/schedule/publish`, { from, to })).published, 2);
  const mine = await w.ok(w.member, "GET", `${w.c}/my-time`);
  assert.equal(mine.upcoming.length, 1);
  assert.equal(mine.upcoming[0].note, "Med pass");
  assert.equal(mine.upcoming[0].locationName, "Oak Lane Home");
  // A change shows as changed. Staff keep the published version until the next publish.
  await w.ok(w.owner, "PATCH", `${w.c}/schedule/${id}`, { date: tomorrow, startTime: "08:00", endTime: "16:30" });
  s = await read(w, from, to);
  assert.equal(s.shifts.find((x: any) => x.id === id).status, "changed");
  assert.equal(new Date((await w.ok(w.member, "GET", `${w.c}/my-time`)).upcoming[0].startsAt).getTime(), new Date(mine.upcoming[0].startsAt).getTime());
  // A delete of a published shift waits for publish too.
  await w.ok(w.owner, "DELETE", `${w.c}/schedule/${id}`);
  s = await read(w, from, to);
  assert.equal(s.shifts.find((x: any) => x.id === id).status, "deleted");
  assert.equal((await w.ok(w.member, "GET", `${w.c}/my-time`)).upcoming.length, 1);
  await w.ok(w.owner, "POST", `${w.L}/schedule/publish`, { from, to });
  assert.equal((await w.ok(w.member, "GET", `${w.c}/my-time`)).upcoming.length, 0);
  assert.equal(w.d.one<{ n: number }>("SELECT COUNT(*) AS n FROM workspent_shifts WHERE id = ?", id).n, 0);
  // A draft that was never published goes at once.
  const draft = (await w.ok(w.owner, "POST", `${w.L}/schedule`, { personId: w.ben.id, date: tomorrow, startTime: "07:00", endTime: "15:30" })).ids[0];
  await w.ok(w.owner, "DELETE", `${w.c}/schedule/${draft}`);
  assert.equal(w.d.one<{ n: number }>("SELECT COUNT(*) AS n FROM workspent_shifts WHERE id = ?", draft).n, 0);
});

test("copy last week makes drafts with the same local times, and skips overlaps and people who are off", async () => {
  const w = await world();
  const last = sundayOf(-1);
  const now = sundayOf(0);
  await w.ok(w.owner, "POST", `${w.L}/schedule`, { personId: w.ana.id, date: plus(last, 1), startTime: "07:00", endTime: "15:30", breakMinutes: 30 });
  await w.ok(w.owner, "POST", `${w.L}/schedule`, { personId: w.ana.id, date: plus(last, 2), startTime: "23:00", endTime: "07:30" });
  await w.ok(w.owner, "POST", `${w.L}/schedule`, { personId: w.ben.id, date: plus(last, 3), startTime: "15:00", endTime: "23:30" });
  await w.ok(w.owner, "POST", `${w.L}/schedule`, { personId: null, date: plus(last, 4), startTime: "15:00", endTime: "23:30" });
  // Ana already works Monday morning this week. Ben is off.
  await w.ok(w.owner, "POST", `${w.L}/schedule`, { personId: w.ana.id, date: plus(now, 1), startTime: "06:00", endTime: "10:00" });
  await w.ok(w.owner, "PATCH", `${w.c}/people/${w.ben.id}`, { isActive: false });
  const r = await w.ok(w.owner, "POST", `${w.L}/schedule/copy`, { weekStart: now });
  assert.deepEqual(r, { copied: 2, skipped: 2 });
  const s = await read(w, now, plus(now, 6));
  const night = s.shifts.find((x: any) => x.personId === w.ana.id && x.startsAt > plus(now, 2));
  assert.ok(night, "the night shift was copied");
  assert.equal(night.status, "draft");
  assert.equal((Date.parse(night.endsAt) - Date.parse(night.startsAt)) / 3_600_000, 8.5);
  assert.equal(s.shifts.filter((x: any) => !x.personId).length, 1, "open shifts are copied");
  assert.equal((await w.call(w.owner, "POST", `${w.L}/schedule/copy`, { weekStart: plus(now, 1) })).status, 400, "a week starts on a Sunday");
});

test("only managers of the location see and change its schedule", async () => {
  const w = await world();
  const from = sundayOf(0);
  const to = plus(from, 6);
  assert.equal((await w.call(w.member, "GET", `${w.L}/schedule?from=${from}&to=${to}`)).status, 403);
  await w.ok(w.owner, "PUT", `${w.L}/managers`, { userIds: [w.other.id] });
  await w.ok(w.other, "GET", `${w.L}/schedule?from=${from}&to=${to}`);
  const id = (await w.ok(w.other, "POST", `${w.L}/schedule`, { personId: w.ben.id, date: plus(from, 2), startTime: "07:00", endTime: "15:30" })).ids[0];
  assert.equal((await w.call(w.member, "PATCH", `${w.c}/schedule/${id}`, { note: "x" })).status, 403);
  assert.equal((await w.call(w.member, "POST", `${w.L}/schedule/publish`, { from, to })).status, 403);
  // A long range is refused.
  assert.equal((await w.call(w.owner, "GET", `${w.L}/schedule?from=${from}&to=${plus(from, 60)}`)).status, 400);
  // The schedule read holds the people of the location and the week limit.
  const s = await read(w, from, to);
  assert.deepEqual(s.people.map((p: any) => p.name), ["Ana R.", "Ben T."]);
  assert.equal(s.weekLimitMinutes, 2400);
});

test("deleting a company deletes its shifts", async () => {
  const w = await world();
  await w.ok(w.owner, "POST", `${w.L}/schedule`, { personId: w.ana.id, date: sundayOf(1), startTime: "07:00", endTime: "15:30" });
  await w.ok(w.owner, "DELETE", `/api/companies/${w.companyId}`, { confirm: "Sunrise Care" });
  assert.equal(w.d.one<{ n: number }>("SELECT COUNT(*) AS n FROM workspent_shifts").n, 0);
});
