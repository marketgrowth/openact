// Schema checks for `npm run sync`. Read docs/naming.md.
//
// 1. Preflight: every migration runs, in deploy order, on an empty in-memory SQLite database.
//    A migration that fails stops sync here, before it can reach a real database.
// 2. Naming rules: each table and column that an app adds is checked against the rules.
//    Problems are warnings for now. Set OPENACT_STRICT=1 to make them errors.
//
// The checks need node:sqlite (Node 22.13 or later). On older Node versions, sync skips them and says so.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Tables made before the naming rules. They keep their names. Never use these names for a new table. */
export const LEGACY_TABLES = new Set([
  // The projects app made these before apps had prefixes.
  "projects",
  "project_members",
  "tasks",
  "attachments",
  "board_columns",
  "invitations",
  "agent_actions",
  "access_requests",
  "vector_outbox"
]);

/** Core migrations up to this one are released. The rules check core tables from later migrations only. */
const CORE_BASELINE = "0013";

const SNAKE = /^[a-z][a-z0-9_]*$/;
const MAX_NAME = 63;

/** The table prefix for an app id: dashes become underscores. "acme-crm" gives "acme_crm_". */
export const tablePrefix = (appId) => `${appId.replace(/-/g, "_")}_`;

async function openSqlite() {
  // Node prints an "experimental" warning when node:sqlite loads. Sync output stays short without it.
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => (String(w?.message ?? w).includes("SQLite") ? undefined : emit.call(process, w, ...rest));
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return new DatabaseSync(":memory:");
  } catch {
    return null;
  } finally {
    process.emitWarning = emit;
  }
}

/**
 * Runs the checks on the migrations in `dir` (the .openact/migrations folder that sync wrote).
 * `apps` are the installed apps' ids. `namingFrom` maps an app id to its first migration that the naming rules check,
 * such as "0004", from "namingFrom" in the app's package.json. Earlier migrations are released and keep their names.
 * Returns { skipped, warnings }. Throws on a failed migration, or on a broken rule when `strict` is true.
 */
export async function checkSchema({ dir, apps, strict = false, namingFrom = {} }) {
  const db = await openSqlite();
  if (!db) return { skipped: "Schema checks need Node 22.13 or later. Sync skipped them.", warnings: [] };
  db.exec("PRAGMA foreign_keys = ON");

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  // Which app a migration file belongs to. Sync names app files "<app-id>_<file>".
  const ownerOf = (file) => apps.find((id) => file.startsWith(`${id}_`)) ?? "core";
  const tables = () => new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name));
  const indexes = () => new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all().map((r) => r.name));

  const made = new Map(); // table -> { owner, file }
  const madeIndexes = new Map();
  let seen = tables();
  let seenIdx = indexes();
  for (const file of files) {
    try {
      db.exec(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      throw new Error(`The migration ${file} fails on an empty database: ${e.message}\n  Fix the migration before you deploy. Sync stopped here.`);
    }
    const now = tables();
    for (const t of now) if (!seen.has(t)) made.set(t, { owner: ownerOf(file), file });
    seen = now;
    const nowIdx = indexes();
    for (const i of nowIdx) if (!seenIdx.has(i)) madeIndexes.set(i, { owner: ownerOf(file), file });
    seenIdx = nowIdx;
  }

  const warnings = [];
  const warn = (file, msg) => warnings.push(`${file}: ${msg}`);
  const checked = (owner, file) => {
    if (owner === "core") return file.slice(0, 4) > CORE_BASELINE;
    const from = namingFrom[owner];
    return !from || file.slice(owner.length + 1, owner.length + 5) >= from;
  };
  const columnsOf = (t) => db.prepare(`PRAGMA table_info("${t}")`).all();
  const fksOf = (t) => db.prepare(`PRAGMA foreign_key_list("${t}")`).all();
  const hasCompany = (t) => columnsOf(t).some((c) => c.name === "company_id");

  for (const [table, { owner, file }] of made) {
    if (LEGACY_TABLES.has(table) || !checked(owner, file)) continue;
    if (!SNAKE.test(table) || table.length > MAX_NAME) warn(file, `The table "${table}" must be lowercase snake_case, ${MAX_NAME} characters or fewer.`);
    if (owner !== "core") {
      const prefix = tablePrefix(owner);
      if (!table.startsWith(prefix)) warn(file, `The table "${table}" must start with the app prefix "${prefix}".`);
      // A longer app id can share a prefix: "acme_crm_" is inside app "acme". Two apps must never claim one table.
      for (const other of apps) {
        if (other !== owner && tablePrefix(other).startsWith(prefix) && table.startsWith(tablePrefix(other)))
          throw new Error(`The table "${table}" from the app "${owner}" uses the prefix of the app "${other}". Rename the table.`);
      }
      // Every row belongs to a company: a company_id column, or a foreign key to a table that has one.
      const tenant = hasCompany(table) || fksOf(table).some((fk) => hasCompany(fk.table));
      if (!tenant) warn(file, `The table "${table}" has no company_id, and no foreign key to a table with one. Every app row belongs to a company.`);
    }
    const fkCols = new Set(fksOf(table).map((fk) => fk.from));
    for (const col of columnsOf(table)) {
      const type = String(col.type).toUpperCase();
      const at = `${table}.${col.name}`;
      if (!SNAKE.test(col.name) || col.name.length > MAX_NAME) warn(file, `The column "${at}" must be lowercase snake_case.`);
      if (col.name.endsWith("_at") && type !== "TEXT") warn(file, `The column "${at}" ends in _at, so it must be TEXT (ISO 8601). Use _ms for epoch milliseconds.`);
      if (col.name.endsWith("_ms") && type !== "INTEGER") warn(file, `The column "${at}" ends in _ms, so it must be INTEGER (epoch milliseconds).`);
      if (/^(is|has)_/.test(col.name) && type !== "INTEGER") warn(file, `The column "${at}" is a yes/no flag, so it must be INTEGER 0 or 1.`);
      // A person who did something can end in _by (created_by), like the core tables do.
      const byPerson = col.name.endsWith("_by") && fksOf(table).some((fk) => fk.from === col.name && fk.table === "users");
      if (fkCols.has(col.name) && !col.name.endsWith("_id") && !byPerson)
        warn(file, `The column "${at}" points at another table, so its name must end in _id (or _by for a person).`);
      if (/(^|_)(token|secret|password|code)$/.test(col.name)) warn(file, `The column "${at}" looks like a secret. Store only a hash, in a column that ends in _hash.`);
    }
  }
  for (const [index, { owner, file }] of madeIndexes) {
    if (!checked(owner, file)) continue;
    if (!index.startsWith("idx_")) warn(file, `The index "${index}" must start with idx_ (idx_<table>_<columns>).`);
  }

  if (strict && warnings.length) throw new Error(`The schema breaks the naming rules (docs/naming.md):\n  ${warnings.join("\n  ")}`);
  return { skipped: null, warnings };
}
