import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { createApp } from "../../packages/core/src/server/worker.ts";
import { SESSION_COOKIE } from "../../packages/core/src/server/auth.ts";
import { apps, catalog } from "../../.openact/server.ts";

/*
 * A whole OpenAct deploy in memory, for tests that call the real routes.
 * SQLite runs every migration in deploy order. D1, R2, the live rooms, Vectorize and Workers AI are small stand-ins.
 * Run tests that use it with `--import ./test/harness/loader.mjs` (npm test does).
 */

const ROOT = join(import.meta.dirname, "..", "..");
export const ORIGIN = "https://deploy.test";

/** The migrations in the order a deploy applies them: core first, then each app (as `npm run sync` writes them). */
export function migrationFiles(): string[] {
  const dir = join(ROOT, ".openact", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"));
}

type Args = unknown[];

/** Enough of D1 for the app: prepare, bind, first, all, run, batch and exec. */
export function d1(db: DatabaseSync) {
  const exec = (sql: string, args: Args) => {
    const p = db.prepare(sql);
    if (p.columns().length) return { results: p.all(...(args as never[])), meta: { changes: 0 } };
    const r = p.run(...(args as never[]));
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  const stmt = (sql: string, args: Args = []): Stmt => ({
    sql,
    args,
    bind: (...a: Args) => stmt(sql, a),
    all: async () => exec(sql, args),
    first: async (col?: string) => {
      const row = (db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined) ?? null;
      return col ? (row?.[col] ?? null) : row;
    },
    run: async () => exec(sql, args),
    raw: async () => db.prepare(sql).all(...(args as never[])).map((r) => Object.values(r as object))
  });
  return {
    prepare: (sql: string) => stmt(sql),
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
    batch: async (list: Stmt[]) => {
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
}
type Stmt = {
  sql: string;
  args: Args;
  bind: (...a: Args) => Stmt;
  all: () => Promise<unknown>;
  first: (col?: string) => Promise<unknown>;
  run: () => Promise<unknown>;
  raw: () => Promise<unknown>;
};

/** Enough of R2 for the app. */
export function r2() {
  const objects = new Map<string, { data: Uint8Array; httpMetadata?: unknown; customMetadata?: Record<string, string> }>();
  const body = (key: string) => {
    const o = objects.get(key);
    if (!o) return null;
    return {
      key,
      size: o.data.byteLength,
      httpMetadata: o.httpMetadata ?? {},
      customMetadata: o.customMetadata ?? {},
      body: new Blob([o.data]).stream(),
      arrayBuffer: async () => o.data.buffer.slice(o.data.byteOffset, o.data.byteOffset + o.data.byteLength),
      text: async () => new TextDecoder().decode(o.data),
      writeHttpMetadata: (h: Headers) => {
        const meta = (o.httpMetadata ?? {}) as { contentType?: string };
        if (meta.contentType) h.set("content-type", meta.contentType);
      }
    };
  };
  return {
    objects,
    put: async (key: string, value: ArrayBuffer | Uint8Array | string, opts: { httpMetadata?: unknown; customMetadata?: Record<string, string> } = {}) => {
      const data = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value as ArrayBuffer);
      objects.set(key, { data, httpMetadata: opts.httpMetadata, customMetadata: opts.customMetadata });
      return { key };
    },
    get: async (key: string) => body(key),
    head: async (key: string) => body(key),
    delete: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
    list: async (opts: { prefix?: string } = {}) => ({
      objects: [...objects.keys()].filter((k) => !opts.prefix || k.startsWith(opts.prefix)).map((key) => ({ key })),
      truncated: false
    })
  };
}

/** Live rooms that do nothing. The suite checks data, not WebSockets. */
function rooms() {
  const stub = { notify: async () => {}, disconnect: async () => {}, fetch: async () => new Response(null, { status: 426 }) };
  return { idFromName: (name: string) => ({ name, toString: () => name }), get: () => stub };
}

/**
 * A Vectorize stand-in that ignores namespaces and filters and returns every stored vector.
 * It acts like a broken index on purpose: the app must check each match against what the person may see.
 */
function vectors() {
  const store = new Map<string, { id: string; namespace?: string; metadata?: Record<string, unknown> }>();
  return {
    store,
    upsert: async (list: Array<{ id: string; namespace?: string; metadata?: Record<string, unknown> }>) => {
      for (const v of list) store.set(v.id, v);
      return { mutationId: "m" };
    },
    insert: async (list: Array<{ id: string; namespace?: string; metadata?: Record<string, unknown> }>) => {
      for (const v of list) store.set(v.id, v);
      return { mutationId: "m" };
    },
    deleteByIds: async (ids: string[]) => {
      for (const id of ids) store.delete(id);
      return { mutationId: "m" };
    },
    getByIds: async (ids: string[]) => ids.map((id) => store.get(id)).filter(Boolean),
    query: async () => ({ count: store.size, matches: [...store.values()].map((v) => ({ id: v.id, score: 0.99, metadata: v.metadata ?? {} })) }),
    describe: async () => ({ dimensions: 768 })
  };
}

/** Workers AI stand-in: embeddings are fixed vectors, text answers are a fixed reply. */
function ai() {
  return {
    run: async (_model: string, input: { text?: string[] }) => {
      if (input && Array.isArray(input.text)) return { data: input.text.map(() => new Array(768).fill(0.01)) };
      return { response: "OK" };
    }
  };
}

export type Person = { id: string; email: string; name: string; token: string };

export type Deploy = ReturnType<typeof makeDeploy>;

/** Builds a deploy with its own in-memory database. */
export function makeDeploy(vars: Record<string, string> = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const sql of migrationFiles()) db.exec(sql);
  const env = {
    DB: d1(db),
    FILES: r2(),
    AI: ai(),
    VECTORS: vectors(),
    PROJECT_ROOMS: rooms(),
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    APP_NAME: "Test deploy",
    EMAIL_FROM: "Test <no-reply@deploy.test>",
    AUTH_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
    SIGNUP_MODE: "open",
    AGENT_ACCESS: "on",
    APP_URL: ORIGIN,
    ...vars
  };
  const app = createApp({ apps, catalog });
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p.catch(() => {})), passThroughOnException: () => {}, props: {} };

  /** Adds a person with a session, as if they signed in. */
  function person(email: string, name = email.split("@")[0]!): Person {
    const id = randomBytes(8).toString("hex");
    const token = randomBytes(24).toString("hex");
    const now = Date.now();
    db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(id, email, name, new Date().toISOString());
    db.prepare("INSERT INTO sessions (id, user_id, user_agent, created_at, expires_at) VALUES (?, ?, 'test', ?, ?)").run(
      createHash("sha256").update(token).digest("hex"),
      id,
      now,
      now + 86400000
    );
    return { id, email, name, token };
  }

  /** Calls a route as a person (or signed out with `null`). The body is JSON, or FormData for uploads. */
  async function call(who: Person | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h = new Headers({ origin: ORIGIN, ...headers });
    if (who) h.set("cookie", `${SESSION_COOKIE}=${who.token}`);
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      h.set("content-type", "application/json");
    }
    const res = await app.fetch(new Request(ORIGIN + path, { method, headers: h, body: payload }), env as never, ctx as never);
    const text = await res.text();
    await Promise.all(pending.splice(0));
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Not JSON (a file or a page).
    }
    return { status: res.status, text, json: json as Record<string, unknown> | null, headers: res.headers };
  }

  const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...(args as never[])) as T;
  const all = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).all(...(args as never[])) as T[];

  return { db, env, app, person, call, one, all };
}
