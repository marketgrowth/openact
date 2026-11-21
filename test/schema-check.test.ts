import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error The sync script is plain JavaScript.
import { checkSchema, tablePrefix } from "../scripts/schema-check.mjs";

/* The schema checks that `npm run sync` runs. Read docs/naming.md. */

const CORE = join(import.meta.dirname, "..", "packages", "core", "migrations");

/** A migrations folder like the one sync writes: the core's files, then the given app files. */
function folder(appFiles: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "openact-schema-"));
  for (const f of readdirSync(CORE).filter((f) => f.endsWith(".sql"))) writeFileSync(join(dir, f), readFileSync(join(CORE, f)));
  for (const [name, sql] of Object.entries(appFiles)) writeFileSync(join(dir, name), sql);
  return dir;
}

async function run(appFiles: Record<string, string>, apps: string[], strict = false) {
  const dir = folder(appFiles);
  try {
    return await checkSchema({ dir, apps, strict });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the prefix of an app id uses underscores", () => {
  assert.equal(tablePrefix("acme-crm"), "acme_crm_");
  assert.equal(tablePrefix("hello"), "hello_");
});

test("a table that follows the rules gives no warnings", async () => {
  const r = await run(
    {
      "crm_0001_init.sql": `CREATE TABLE crm_deals (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
        owner_id TEXT REFERENCES users (id),
        is_won INTEGER NOT NULL DEFAULT 0,
        token_hash TEXT,
        closed_ms INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_crm_deals_company ON crm_deals (company_id);`
    },
    ["crm"]
  );
  assert.equal(r.skipped, null);
  assert.deepEqual(r.warnings, []);
});

test("broken rules are warnings, or errors in strict mode", async () => {
  const files = {
    "crm_0001_init.sql": `CREATE TABLE deals (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      is_won TEXT,
      owner TEXT REFERENCES users (id),
      api_token TEXT
    );
    CREATE INDEX deals_by_owner ON deals (owner);`
  };
  const r = await run(files, ["crm"]);
  const text = r.warnings.join("\n");
  assert.match(text, /must start with the app prefix "crm_"/);
  assert.match(text, /no company_id/);
  assert.match(text, /deals\.created_at" ends in _at, so it must be TEXT/);
  assert.match(text, /deals\.is_won" is a yes\/no flag/);
  assert.match(text, /deals\.owner" points at another table/);
  assert.match(text, /deals\.api_token" looks like a secret/);
  assert.match(text, /index "deals_by_owner" must start with idx_/);
  await assert.rejects(run(files, ["crm"], true), /breaks the naming rules/);
});

test("a row can reach its company through a foreign key", async () => {
  const r = await run(
    {
      "crm_0001_init.sql": `CREATE TABLE crm_deals (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies (id));
      CREATE TABLE crm_deal_notes (id TEXT PRIMARY KEY, deal_id TEXT NOT NULL REFERENCES crm_deals (id), body TEXT NOT NULL);`
    },
    ["crm"]
  );
  assert.deepEqual(r.warnings, []);
});

test("two apps can never claim the same table prefix", async () => {
  await assert.rejects(
    run({ "acme_0001_init.sql": "CREATE TABLE acme_crm_deals (id TEXT PRIMARY KEY, company_id TEXT REFERENCES companies (id));" }, ["acme", "acme-crm"]),
    /uses the prefix of the app "acme-crm"/
  );
});

test("a migration that fails on an empty database stops sync", async () => {
  await assert.rejects(run({ "crm_0001_init.sql": "CREATE TABLE crm_deals (id TEXT PRIMARY KEY, company_id TEXT REFERENCES no_such_table (id), oops" }, ["crm"]), /fails on an empty database/);
});

test("a person column can end in _by", async () => {
  const r = await run(
    { "crm_0001_init.sql": "CREATE TABLE crm_deals (id TEXT PRIMARY KEY, company_id TEXT REFERENCES companies (id), created_by TEXT REFERENCES users (id), closed_by TEXT REFERENCES crm_deals (id));" },
    ["crm"]
  );
  assert.deepEqual(r.warnings.map((w: string) => w.replace(/^.*?: /, "")), ['The column "crm_deals.closed_by" points at another table, so its name must end in _id (or _by for a person).']);
});

test("an app's released migrations keep their names", async () => {
  const files = {
    "crm_0001_init.sql": "CREATE TABLE crm_deals (id TEXT PRIMARY KEY, company_id TEXT REFERENCES companies (id)); CREATE INDEX deals_old ON crm_deals (company_id);",
    "crm_0002_more.sql": "CREATE INDEX deals_new ON crm_deals (id);"
  };
  const dir = folder(files);
  try {
    const r = await checkSchema({ dir, apps: ["crm"], namingFrom: { crm: "0002" } });
    assert.deepEqual(r.warnings.map((w: string) => w.replace(/: .*/, "")), ["crm_0002_more.sql"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("released core tables and the legacy Projects tables are not checked", async () => {
  const r = await run({}, []);
  assert.deepEqual(r.warnings, []);
});
