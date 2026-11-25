import { Hono, type Context } from "hono";
import { HttpError, companyAppState, appOffError, newId, nowIso, oneOf, readJson, sha256Hex, type AppEnv, type Env } from "@openact/core/server";
import {
  APP_ID,
  DEVICE_HEADER,
  LATE_SYNC_MAX_MS,
  PIN_LOCK_MS,
  PIN_TRIES,
  PUNCH_KINDS,
  allowedKinds,
  buildShifts,
  clockState,
  pinProblem,
  readLimits,
  type DeviceHello,
  type PinAnswer,
  type PunchKind
} from "../shared/rules.ts";
import { pinHash, recentPersonPunches, sameText, type DeviceRow } from "./store.ts";

/*
 * The time clock device. It has no sign-in. It sends its device key in the x-workspent-device header.
 * The server keeps only a hash of the key. Switch off empties the hash, so the key stops working at once.
 * A PIN finds a person at the device's location only. Wrong PINs in a row lock the PIN pad of the device.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface DeviceContext extends DeviceRow {
  location_name: string;
  time_zone: string;
  flags_json: string;
  location_archived: number;
}

const NOT_SET_UP = "This device is not a time clock, or an admin switched it off. Ask an admin to set it up again in WorkSpent > Locations and devices.";

/** The device of the request, checked against its key hash. Also checks that WorkSpent is on for its company. */
async function deviceOf(c: Context<AppEnv>): Promise<DeviceContext> {
  const key = c.req.header(DEVICE_HEADER) ?? "";
  const dot = key.indexOf(".");
  const id = dot > 0 ? key.slice(0, dot) : "";
  const secret = dot > 0 ? key.slice(dot + 1) : "";
  if (!UUID.test(id) || secret.length < 20 || secret.length > 100) throw new HttpError(401, NOT_SET_UP, "no_device");
  const row = await c.env.DB.prepare(
    `SELECT d.*, l.name AS location_name, l.time_zone, l.flags_json, l.is_archived AS location_archived
     FROM workspent_devices d JOIN workspent_locations l ON l.id = d.location_id AND l.company_id = d.company_id WHERE d.id = ?`
  )
    .bind(id)
    .first<DeviceContext>();
  const hash = await sha256Hex(secret);
  if (!row || row.is_active !== 1 || !row.key_hash || !sameText(hash, row.key_hash)) throw new HttpError(401, NOT_SET_UP, "no_device");
  const state = await companyAppState(c.env, row.company_id);
  if (!state.enabled(APP_ID)) throw appOffError(APP_ID, state);
  if (row.location_archived === 1) throw new HttpError(403, "This location is archived. Ask an admin to set up this device for another location.", "no_device");
  return row;
}

const ip = (c: Context<AppEnv>) => (c.req.header("cf-connecting-ip") || "").slice(0, 64) || null;

function lockedUntil(d: DeviceRow, nowMs: number): number | null {
  return d.locked_until_ms && d.locked_until_ms > nowMs ? d.locked_until_ms : null;
}

function lockError(until: number): HttpError {
  const mins = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
  return new HttpError(
    423,
    `Too many wrong PINs. The PIN pad is locked for ${mins} more minute${mins === 1 ? "" : "s"}. A manager can unlock it in WorkSpent.`,
    "pin_locked"
  );
}

/**
 * Finds the person with this PIN at the device's location. Counts wrong PINs, and locks the pad after PIN_TRIES.
 * Returns null for a wrong PIN.
 */
async function personByPin(env: Env, url: string, d: DeviceContext, pin: string, nowMs: number): Promise<{ id: string; name: string } | null> {
  const until = lockedUntil(d, nowMs);
  if (until) throw lockError(until);
  const hash = await pinHash(env, url, d.company_id, pin);
  const person = await env.DB.prepare(
    `SELECT p.id, p.name FROM workspent_people p JOIN workspent_person_locations pl ON pl.person_id = p.id
     WHERE pl.location_id = ? AND p.company_id = ? AND p.pin_hash = ? AND p.is_active = 1`
  )
    .bind(d.location_id, d.company_id, hash)
    .first<{ id: string; name: string }>();
  if (person) {
    if (d.wrong_pin_count) await env.DB.prepare("UPDATE workspent_devices SET wrong_pin_count = 0 WHERE id = ?").bind(d.id).run();
    d.wrong_pin_count = 0;
    return person;
  }
  const count = d.wrong_pin_count + 1;
  if (count >= PIN_TRIES) {
    d.locked_until_ms = nowMs + PIN_LOCK_MS;
    d.wrong_pin_count = 0;
    await env.DB.prepare("UPDATE workspent_devices SET wrong_pin_count = 0, locked_until_ms = ? WHERE id = ?").bind(d.locked_until_ms, d.id).run();
  } else {
    d.wrong_pin_count = count;
    await env.DB.prepare("UPDATE workspent_devices SET wrong_pin_count = ? WHERE id = ?").bind(count, d.id).run();
  }
  return null;
}

const WRONG_PIN = "That PIN is not right for this location. Try again.";

function readPin(body: Record<string, unknown>): string {
  const pin = body.pin;
  const problem = pinProblem(pin);
  if (problem) throw new HttpError(400, problem);
  return pin as string;
}

async function stateOf(env: Env, d: DeviceContext, personId: string, nowMs: number) {
  const punches = await recentPersonPunches(env, d.company_id, personId, nowMs);
  return clockState(buildShifts(punches, d.time_zone, readLimits(d.flags_json), nowMs));
}

export const deviceRoutes = new Hono<AppEnv>();

/** The device says hello every 2 minutes. The server saves the time and the internet address, and sends its own time. */
deviceRoutes.get("/", async (c) => {
  const d = await deviceOf(c);
  const now = Date.now();
  await c.env.DB.prepare("UPDATE workspent_devices SET last_seen_at = ?, last_ip_address = ? WHERE id = ?").bind(nowIso(), ip(c), d.id).run();
  const until = lockedUntil(d, now);
  const hello: DeviceHello = {
    device: { name: d.name, kind: d.kind },
    location: { name: d.location_name, timeZone: d.time_zone },
    serverTime: new Date(now).toISOString(),
    lockedUntil: until ? new Date(until).toISOString() : null
  };
  return c.json(hello);
});

/** A person types their PIN. The answer says who they are and which buttons to show. */
deviceRoutes.post("/pin", async (c) => {
  const d = await deviceOf(c);
  const body = await readJson(c);
  const pin = readPin(body);
  const now = Date.now();
  const person = await personByPin(c.env, c.req.url, d, pin, now);
  if (!person) throw new HttpError(403, WRONG_PIN, "wrong_pin");
  const s = await stateOf(c.env, d, person.id, now);
  const answer: PinAnswer = { person: { name: person.name }, state: s.state, since: s.since, kinds: allowedKinds(s.state) };
  return c.json(answer);
});

/** Clock in, a break, or clock out, now. The time comes from the server. */
deviceRoutes.post("/punch", async (c) => {
  const d = await deviceOf(c);
  const body = await readJson(c);
  const pin = readPin(body);
  const kind = oneOf(body.kind, "kind", PUNCH_KINDS);
  const now = Date.now();
  const person = await personByPin(c.env, c.req.url, d, pin, now);
  if (!person) throw new HttpError(403, WRONG_PIN, "wrong_pin");
  const s = await stateOf(c.env, d, person.id, now);
  if (!allowedKinds(s.state).includes(kind)) {
    const what = s.state === "out" ? "You are not clocked in." : s.state === "on_break" ? "You are on a meal break." : "You are already clocked in.";
    throw new HttpError(409, `${what} Start over and pick another button.`, "wrong_state");
  }
  const at = new Date(now).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO workspent_punches (id, company_id, person_id, location_id, kind, punched_at, source, device_id, ip_address, is_late_sync, received_at)
     VALUES (?, ?, ?, ?, ?, ?, 'device', ?, ?, 0, ?)`
  )
    .bind(newId(), d.company_id, person.id, d.location_id, kind, at, d.id, ip(c), at)
    .run();
  return c.json({ ok: true, person: { name: person.name }, kind, at }, 201);
});

/**
 * Clock-ins that the device saved while it was offline. Each has its own id, so a second send does not add it twice.
 * The server checks each PIN now. It does not check the clock state: the hours page flags what does not fit.
 */
deviceRoutes.post("/sync", async (c) => {
  const d = await deviceOf(c);
  const body = await readJson(c);
  const list = body.punches;
  if (!Array.isArray(list) || list.length > 200) throw new HttpError(400, "Send punches as a list of 200 or fewer.");
  const now = Date.now();
  const saved: string[] = [];
  const rejected: Array<{ id: string; problem: string }> = [];
  for (const raw of list) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const id = typeof item.id === "string" && UUID.test(item.id) ? item.id : null;
    if (!id) {
      rejected.push({ id: String(item.id ?? ""), problem: "The saved clock-in has no valid id." });
      continue;
    }
    const kind = PUNCH_KINDS.includes(item.kind as PunchKind) ? (item.kind as PunchKind) : null;
    const atMs = typeof item.at === "string" ? Date.parse(item.at) : NaN;
    const pinBad = pinProblem(item.pin);
    if (!kind || Number.isNaN(atMs) || pinBad) {
      rejected.push({ id, problem: pinBad ?? "The saved clock-in is not complete." });
      continue;
    }
    if (atMs > now + 120_000 || atMs < now - LATE_SYNC_MAX_MS) {
      rejected.push({ id, problem: "The saved clock-in is too old, or its time is wrong. Ask a manager to add it." });
      continue;
    }
    const until = lockedUntil(d, now);
    if (until) {
      rejected.push({ id, problem: "The PIN pad is locked. Ask a manager to add this clock-in." });
      continue;
    }
    const person = await personByPin(c.env, c.req.url, d, item.pin as string, now);
    if (!person) {
      rejected.push({ id, problem: "The PIN was not right. Ask a manager to add this clock-in." });
      continue;
    }
    const r = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO workspent_punches (id, company_id, person_id, location_id, kind, punched_at, source, device_id, ip_address, is_late_sync, received_at)
       VALUES (?, ?, ?, ?, ?, ?, 'device', ?, ?, 1, ?)`
    )
      .bind(id, d.company_id, person.id, d.location_id, kind, new Date(atMs).toISOString(), d.id, ip(c), nowIso())
      .run();
    // An id that is already there belongs to an earlier send of the same clock-in, or to another row. Either way, stop here.
    if (r.meta.changes) saved.push(id);
    else {
      const same = await c.env.DB.prepare("SELECT 1 FROM workspent_punches WHERE id = ? AND device_id = ?").bind(id, d.id).first();
      if (same) saved.push(id);
      else rejected.push({ id, problem: "The saved clock-in has an id that is in use." });
    }
  }
  return c.json({ saved, rejected });
});
