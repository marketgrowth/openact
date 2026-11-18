import type { Env } from "./env.ts";
import type { ServerApp } from "./apps.ts";
import { DUPLICATE_MAX_BYTES, DUPLICATE_MAX_FILES, type CopyCount } from "../shared/site.ts";

/*
 * Duplicate a company: a super admin makes a new company with a copy of another company's content.
 *
 * The core copies the company itself: its logo, its app settings and permissions, its app blocks and its AI defaults.
 * Each app copies its own data in its companyDuplicating hook, with the tools in CompanyCopyContext.
 * The copy leaves out people, invitations, plans, the company's AI key, the email domain, comments, share links and history.
 * The person who duplicates is the only owner of the new company.
 *
 * When any step fails, the new company and its files are deleted, so a failed duplicate leaves nothing behind.
 * This module imports only types and pure modules, so tests can run it on SQLite.
 */

/** What an app's companyDuplicating hook gets. */
export interface CompanyCopyContext {
  /** The company to copy. */
  fromId: string;
  /** The new company. It exists, and the person who duplicates is its owner. */
  toId: string;
  /** The person who duplicates. Use this id for created_by and owner rows. */
  userId: string;
  /** The time of the duplicate, as an ISO string. */
  now: string;
  /** A new random id. */
  newId: () => string;
  /**
   * Statements that copy many rows with INSERT ... SELECT, in chunks.
   * In `sql`, ?1 is a JSON array of `rows`. Read it with json_each(?1) and json_extract(value, '$.<field>').
   * More values in `binds` are ?2, ?3 and so on. Run the statements in one DB.batch.
   */
  copyStatements: (sql: string, rows: ReadonlyArray<Record<string, string | number | null>>, ...binds: Array<string | number | null>) => D1PreparedStatement[];
  /**
   * Copies files in R2, a few at a time. For each pair, returns the size of the copy, or null when the source file is missing.
   * The core counts the files against the limits and deletes the copies if the duplicate fails.
   */
  copyFiles: (pairs: ReadonlyArray<{ from: string; to: string }>) => Promise<Array<{ size: number } | null>>;
}

/** A plain error with a status. The route turns it into an HttpError. */
export class CopyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A person can own this many companies. */
export const MAX_COMPANIES_PER_PERSON = 20;

/** Rows per INSERT. The JSON of a chunk stays far under the 2 MB limit for one value in D1. */
const CHUNK_ROWS = 200;
/** Files copied at the same time. */
const FILE_CONCURRENCY = 6;

type CopyApp = Pick<ServerApp, "id" | "hooks">;

/** Statements that copy rows by a JSON list, in chunks. See CompanyCopyContext.copyStatements. */
export function copyStatements(
  db: D1Database,
  sql: string,
  rows: ReadonlyArray<Record<string, string | number | null>>,
  ...binds: Array<string | number | null>
): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) out.push(db.prepare(sql).bind(JSON.stringify(rows.slice(i, i + CHUNK_ROWS)), ...binds));
  return out;
}

/** Deletes every R2 object under a prefix. */
async function deleteUnder(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const list = await bucket.list({ prefix, cursor, limit: 1000 });
    if (list.objects.length) await bucket.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}

/**
 * Deletes a company, its app data and its files. The Delete company route and a failed duplicate use it.
 * Apps delete their data and files first, in their companyDeleting hooks.
 */
export async function deleteCompanyData(env: Env, companyId: string, apps: readonly CopyApp[]): Promise<void> {
  for (const app of apps) await app.hooks?.companyDeleting?.(env, companyId);
  await deleteUnder(env.FILES, `companies/${companyId}/`);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET current_company_id = NULL WHERE current_company_id = ?").bind(companyId),
    env.DB.prepare("DELETE FROM companies WHERE id = ?").bind(companyId)
  ]);
}

/**
 * Runs fn on each item, with at most `limit` running at the same time.
 * After an error, no new item starts, and it waits for the running ones. So no copy finishes after the clean-up.
 */
async function eachLimited<T>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        await fn(items[i]!, i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
  const bad = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (bad) throw bad.reason;
}

/**
 * Makes a new company named `name` with a copy of the content of company `fromId`.
 * `userId` becomes its only owner. Returns the new id and what each app copied.
 * Throws CopyError when the source company is missing or the copy is too large.
 */
export async function duplicateCompany(
  env: Env,
  opts: { fromId: string; name: string; userId: string; newId?: () => string; now?: string },
  apps: readonly CopyApp[]
): Promise<{ id: string; copied: CopyCount[] }> {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const now = opts.now ?? new Date().toISOString();
  const src = await env.DB.prepare("SELECT id, logo_key, logo_type, ai_defaults FROM companies WHERE id = ?")
    .bind(opts.fromId)
    .first<{ id: string; logo_key: string | null; logo_type: string | null; ai_defaults: string }>();
  if (!src) throw new CopyError(404, "This company does not exist. It may have been deleted.");

  const toId = newId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO companies (id, name, ai_defaults, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      toId,
      opts.name,
      src.ai_defaults,
      opts.userId,
      now,
      now
    ),
    env.DB.prepare("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(toId, opts.userId, now)
  ]);

  // Files that were copied, so a failed duplicate can delete them, and the totals for the limits.
  const copiedKeys: string[] = [];
  let files = 0;
  let bytes = 0;
  const copyFile = async (fromKey: string, toKey: string): Promise<{ size: number } | null> => {
    // Count the file before the first await, so files copied at the same time cannot pass the limit together.
    if (++files > DUPLICATE_MAX_FILES)
      throw new CopyError(400, `This company has more than ${DUPLICATE_MAX_FILES} files. A duplicate can copy up to ${DUPLICATE_MAX_FILES}. Delete some files first.`);
    const obj = await env.FILES.get(fromKey);
    if (!obj) {
      files--;
      return null;
    }
    bytes += obj.size;
    if (bytes > DUPLICATE_MAX_BYTES) {
      await obj.body?.cancel().catch(() => undefined);
      throw new CopyError(400, `The files in this company are larger than ${Math.round(DUPLICATE_MAX_BYTES / 1024 / 1024)} MB. Delete some files first.`);
    }
    const data = await obj.arrayBuffer();
    copiedKeys.push(toKey);
    await env.FILES.put(toKey, data, { httpMetadata: obj.httpMetadata, customMetadata: obj.customMetadata });
    return { size: data.byteLength };
  };

  try {
    // The company: app settings and permissions, app blocks and the logo.
    const stmts: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO company_apps (company_id, app_id, enabled, permissions, updated_by, updated_at)
         SELECT ?, app_id, enabled, permissions, ?, ? FROM company_apps WHERE company_id = ?`
      ).bind(toId, opts.userId, now, opts.fromId),
      env.DB.prepare(
        `INSERT INTO company_app_blocks (company_id, app_id, blocked_by, created_at)
         SELECT ?, app_id, ?, ? FROM company_app_blocks WHERE company_id = ?`
      ).bind(toId, opts.userId, now, opts.fromId)
    ];
    if (src.logo_key && (await copyFile(src.logo_key, `companies/${toId}/logo`))) {
      stmts.push(
        env.DB.prepare("UPDATE companies SET logo_key = ?, logo_type = ?, logo_updated_at = ? WHERE id = ?").bind(`companies/${toId}/logo`, src.logo_type, now, toId)
      );
    }
    await env.DB.batch(stmts);

    // Each app copies its own data.
    const ctx: CompanyCopyContext = {
      fromId: opts.fromId,
      toId,
      userId: opts.userId,
      now,
      newId,
      copyStatements: (sql, rows, ...binds) => copyStatements(env.DB, sql, rows, ...binds),
      copyFiles: async (pairs) => {
        const out: Array<{ size: number } | null> = new Array(pairs.length).fill(null);
        await eachLimited(pairs, FILE_CONCURRENCY, async (p, i) => {
          out[i] = await copyFile(p.from, p.to);
        });
        return out;
      }
    };
    const copied: CopyCount[] = [];
    for (const app of apps) {
      const hook = app.hooks?.companyDuplicating;
      if (hook) copied.push(...(await hook(env, ctx)));
    }
    return { id: toId, copied };
  } catch (err) {
    // Leave nothing behind: the new company, its app data and every file that was copied.
    try {
      await deleteCompanyData(env, toId, apps);
      for (let i = 0; i < copiedKeys.length; i += 1000) await env.FILES.delete(copiedKeys.slice(i, i + 1000));
    } catch (cleanup) {
      console.error("[openact] Could not remove a failed duplicate", toId, cleanup);
    }
    throw err;
  }
}
