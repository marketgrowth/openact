import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MAX_ATTEMPTS, MAX_CODES_PER_EMAIL, MAX_FAILED_PER_DAY, hashCode, saveCode, useCode } from "../packages/core/src/server/login-codes.ts";

/*
 * Sign-in codes, run on SQLite with the core migrations.
 * The D1 stand-in waits a moment before each call, like a call over the network,
 * so requests sent at the same time can mix their reads and writes. A batch runs as one transaction, as on D1.
 */

const ROOT = join(import.meta.dirname, "..");
const SECRET = "test-secret-0123456789";
const EMAIL = "person@example.com";
const CODE = "123456";

function setup() {
  const db = new DatabaseSync(":memory:");
  const dir = "packages/core/migrations";
  for (const f of readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(ROOT, dir, f), "utf8"));
  const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3));
  const exec = (sql: string, args: unknown[]) => {
    const p = db.prepare(sql);
    if (/^\s*select/i.test(sql) || /returning/i.test(sql)) return { results: p.all(...(args as never[])), meta: { changes: 0 } };
    const r = p.run(...(args as never[]));
    return { results: [], meta: { changes: Number(r.changes) } };
  };
  const stmt = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => {
      await tick();
      return db.prepare(sql).get(...(args as never[])) ?? null;
    },
    all: async () => {
      await tick();
      return exec(sql, args);
    },
    run: async () => {
      await tick();
      return exec(sql, args);
    }
  });
  const DB = {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: Array<ReturnType<typeof stmt>>) => {
      await tick();
      db.exec("BEGIN");
      try {
        const out = list.map((s) => exec(s.sql, s.args));
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
  };
  return { db, env: { DB } as never };
}

async function newCode(env: never, now = Date.now(), ip = "1.1.1.1") {
  await saveCode(env, { email: EMAIL, ip, codeHash: await hashCode(SECRET, EMAIL, CODE), now });
}

const attempt = (env: never, code: string, now = Date.now()) =>
  useCode(env, { email: EMAIL, code, secret: SECRET, now }).then(
    () => "ok",
    (e: { message: string }) => (e.message.includes("not correct") ? "wrong" : e.message.includes("expired") || e.message.includes("used") ? "closed" : e.message)
  );

const tally = (list: string[]) => list.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});

test("parallel wrong codes get no more than the tries of one code", async () => {
  const { env } = setup();
  await newCode(env);
  const wrong = Array.from({ length: 60 }, (_, i) => String(200000 + i));
  const t = tally(await Promise.all(wrong.map((c) => attempt(env, c))));
  assert.equal(t.wrong, MAX_ATTEMPTS);
  assert.equal(t.closed, 60 - MAX_ATTEMPTS);
  // The code is used up, so the right code does not work now.
  assert.equal(await attempt(env, CODE), "closed");
});

test("the right code works once, also when it is sent many times at once", async () => {
  const { db, env } = setup();
  await newCode(env);
  assert.equal(await attempt(env, "000001"), "wrong");
  assert.equal(await attempt(env, "000002"), "wrong");
  const t = tally(await Promise.all(Array.from({ length: 10 }, () => attempt(env, CODE))));
  assert.equal(t.ok, 1);
  // Only the wrong tries count. The correct try gave its count back.
  const row = db.prepare("SELECT attempts, used_at FROM login_codes").get() as { attempts: number; used_at: number | null };
  assert.equal(row.attempts, 2);
  assert.ok(row.used_at);
});

test("an expired code does not work", async () => {
  const { env } = setup();
  const now = Date.now();
  await newCode(env, now - 11 * 60000);
  assert.equal(await attempt(env, CODE, now), "closed");
});

test("parallel code requests save no more codes than the limit, and only the newest works", async () => {
  const { db, env } = setup();
  const results = await Promise.all(Array.from({ length: 20 }, () => newCode(env).then(() => "saved", (e: { status: number }) => String(e.status))));
  const t = tally(results);
  assert.equal(t.saved, MAX_CODES_PER_EMAIL);
  assert.equal(t["429"], 20 - MAX_CODES_PER_EMAIL);
  const open = db.prepare("SELECT COUNT(*) AS n FROM login_codes WHERE used_at IS NULL").get() as { n: number };
  assert.equal(open.n, 1);
  assert.equal(await attempt(env, CODE), "ok");
});

test("an email with too many wrong tries in 24 hours gets no new code", async () => {
  const { env } = setup();
  const start = Date.now() - 20 * 3600000;
  let now = start;
  for (let i = 0; i < MAX_FAILED_PER_DAY / MAX_ATTEMPTS; i++) {
    now += 20 * 60000; // past the 15 minute limit per email
    await newCode(env, now);
    for (let k = 0; k < MAX_ATTEMPTS; k++) assert.equal(await attempt(env, "999999", now), "wrong");
  }
  now += 20 * 60000;
  await assert.rejects(newCode(env, now), (e: { status: number; code?: string }) => e.status === 429 && e.code === "sign_in_locked");
  // When the wrong tries are 24 hours old, codes work again.
  await newCode(env, start + 25 * 3600000);
  assert.equal(await attempt(env, CODE, start + 25 * 3600000), "ok");
});
