#!/usr/bin/env node
/*
 * The OpenAct app tool.
 *
 *   npm run openact -- list                          Shows the installed apps.
 *   npm run openact -- directory                     Shows the apps in the OpenAct app directory (directory/apps.json).
 *   npm run openact -- add <id>                      Installs an app from the directory by its id, such as "contacts".
 *   npm run openact -- add github:owner/repo[#ref]   Copies an app from GitHub into apps/<id> and installs it.
 *   npm run openact -- add github:owner/repo/apps/x[#ref]  Copies one app from a repository that holds several apps.
 *   npm run openact -- add ./path/to/app            Copies an app from a folder on this computer, for example while you build it.
 *   npm run openact -- update <id>                   Copies the app again from where it came from.
 *   npm run openact -- remove <id>                   Removes the app from this OpenAct. Its tables stay in the database.
 *   npm run openact -- primary <id>                  Makes the app the primary app. It goes at the top of the app rail, above a divider.
 *   npm run openact -- primary none                  Removes the primary app. The rail shows the apps in install order.
 *   npm run openact -- sync                          Writes the files in .openact/ from openact.apps.json.
 *
 * An app is a folder with a package.json that has an "openact" field:
 *   { "id": "orbytt", "name": "Orbytt", "server": "./src/server/index.ts", "client": "./src/client/index.tsx",
 *     "migrations": "./migrations", "durableObjects": ["GroupRoom"], "enabledByDefault": true }
 *
 * "enabledByDefault": false makes each company turn the app on in Company settings before it shows.
 * "requiresApps": ["projects"] lists apps that must be installed too. "optionalApps" lists apps the app uses when they are there.
 * "scope": "workspace" makes the app workspace-aware: it keeps its rows per workspace. Default: "company" (company-wide).
 * "plan": "director" or "producer" makes the app a paid app. It is locked in companies without that plan.
 * Only official MarketGrowth apps use "plan". See https://docs.openact.ing/plans.
 * "released": "YYYY-MM-DD" is the day this version was released. A paid app needs it for the license fallback.
 * "requiresCore": "0.2.0" is the oldest core version the app works with. Sync stops when the core is older.
 * "testedCore": "0.3" is the newest core version the app was tested with. Sync warns when the core is newer.
 * Each class in "durableObjects" needs a binding and a migration in wrangler.jsonc. Sync checks it.
 *
 * Like shadcn/ui, `add` copies the app's code into your repository. You own it, and you can read and change it.
 * `update` replaces the folder, so keep your own changes in git or send them to the app's authors.
 * Private repositories work when git can sign in to GitHub on this computer.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { checkSchema } from "./schema-check.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const REGISTRY = join(ROOT, "openact.apps.json");
const OUT = join(ROOT, ".openact");
const CORE_MIGRATIONS = join(ROOT, "packages/core/migrations");
const CORE_PACKAGE = join(ROOT, "packages/core/package.json");
const WRANGLER = join(ROOT, "wrangler.jsonc");
/** Durable Object classes that the core exports. The host exports them in src/worker.ts. */
const CORE_DURABLE_OBJECTS = ["ProjectRoom"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = /^\d+\.\d+(\.\d+)?$/;
const DIRECTORY = join(ROOT, "directory/apps.json");
const ID = /^[a-z][a-z0-9-]{1,30}$/;
const PAID_PLANS = ["director", "producer"];
const SCOPES = ["company", "workspace"];
const PLAN_NAMES = { director: "Director", producer: "Producer" };

const temps = [];
const fail = (msg) => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
  console.error(`openact: ${msg}`);
  process.exit(1);
};

function readRegistry() {
  if (!existsSync(REGISTRY)) return { apps: [] };
  const data = JSON.parse(readFileSync(REGISTRY, "utf8"));
  if (!Array.isArray(data.apps)) fail('openact.apps.json must have an "apps" list.');
  return data;
}

function writeRegistry(data) {
  writeFileSync(REGISTRY, JSON.stringify(data, null, 2) + "\n");
}

/** The app directory: listed apps, and ids reserved for OpenAct itself. */
function readDirectory() {
  if (!existsSync(DIRECTORY)) return { apps: [], systemIds: [] };
  const d = JSON.parse(readFileSync(DIRECTORY, "utf8"));
  return { apps: d.apps ?? [], systemIds: d.systemIds ?? [] };
}

const baseSource = (s) => (s ?? "").replace(/#.*$/, "");

/**
 * Official app ids belong to their official source. App ids also become table, route and file prefixes,
 * so the ids in systemIds belong to OpenAct itself.
 */
function checkReserved(m, fetched) {
  const dir = readDirectory();
  if (dir.systemIds.includes(m.id)) fail(`The id "${m.id}" is reserved for OpenAct itself. Give your app another id, such as "acme-${m.id}".`);
  const entry = dir.apps.find((a) => a.id === m.id);
  if (!entry?.reserved) return;
  if (baseSource(fetched.source) === baseSource(entry.source)) return;
  if (fetched.source.startsWith("path:")) {
    console.warn(`openact: warning: "${m.id}" is reserved for the official ${entry.name} app. Use another id before you share this app.`);
    return;
  }
  fail(`The id "${m.id}" is reserved for the official ${entry.name} app (${baseSource(entry.source)}). Give your app another id, such as "acme-${m.id}". You can keep "${entry.name}" as its name.`);
}

/**
 * True when MarketGrowth reviewed the code at this source: an official app ("reserved") or a verified one ("reviewed")
 * in the directory, fetched from the source that the directory lists. Read docs/security.md.
 */
function isReviewed(m, fetched) {
  const entry = readDirectory().apps.find((a) => a.id === m.id);
  return !!entry && (entry.reserved || entry.reviewed) && baseSource(fetched.source) === baseSource(entry.source);
}

/**
 * Installed apps run with full access to the deploy: every company's data and the deploy's secrets.
 * Until sandboxed apps ship, an app that nobody reviewed installs only with --trust. Your own folders (./path) are yours.
 */
function checkTrust(m, fetched) {
  if (fetched.source.startsWith("path:") || isReviewed(m, fetched)) return;
  const warning =
    `"${m.name}" (${baseSource(fetched.source)}) is not reviewed. Until sandboxed apps ship, an app runs with full access: ` +
    "the data of every company on this deploy, and the deploy's secrets.";
  if (!FLAGS.has("--trust"))
    fail(`${warning}\n  Install it only if you trust its author and read its code. Then run the command again with --trust.\n  Never use --trust on a deploy that hosts other people's companies. Read https://docs.openact.ing/security`);
  console.warn(`openact: warning: ${warning} You chose to trust it.`);
}

/** Finds an app in the directory by its id. Returns its source. */
function directorySource(id) {
  const entry = readDirectory().apps.find((a) => a.id === id);
  if (!entry) fail(`No app with the id "${id}" is in the directory. Run \`npm run openact -- directory\` to see the apps, or use github:owner/repo.`);
  if (entry.status === "built-in") fail(`${entry.name} is part of OpenAct, so it is already installed.`);
  if (entry.status === "planned")
    fail(`"${id}" is reserved for the official ${entry.name} app, which is not ready yet. See https://docs.openact.app/directory.`);
  return entry.source;
}

/** Reads and checks the "openact" field of an app folder. `label` names the folder in messages. */
function manifest(dir, label = relative(ROOT, dir)) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) fail(`${label} has no package.json, so it is not an OpenAct app.`);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const m = pkg.openact;
  if (!m || typeof m !== "object") fail(`The package.json of ${label} has no "openact" field, so it is not an OpenAct app.`);
  if (!ID.test(m.id ?? "")) fail(`The app id "${m.id}" must be 2 to 31 lowercase letters, numbers or dashes, starting with a letter.`);
  for (const key of ["server", "client"]) {
    if (m[key] && !existsSync(join(dir, m[key]))) fail(`The app "${m.id}" lists ${key}: ${m[key]}, but that file does not exist.`);
  }
  if (m.enabledByDefault !== undefined && typeof m.enabledByDefault !== "boolean") fail(`The app "${m.id}" has "enabledByDefault": it must be true or false.`);
  if (m.scope !== undefined && !SCOPES.includes(m.scope)) fail(`The app "${m.id}" has "scope": "${m.scope}". Use ${SCOPES.join(" or ")}.`);
  if (m.plan !== undefined && !PAID_PLANS.includes(m.plan)) fail(`The app "${m.id}" has "plan": "${m.plan}". Use ${PAID_PLANS.join(" or ")}, or leave it out for a free app.`);
  if (m.released !== undefined && (typeof m.released !== "string" || !DAY.test(m.released) || Number.isNaN(Date.parse(`${m.released}T00:00:00Z`))))
    fail(`The app "${m.id}" has "released": "${m.released}". Use a day such as "2026-11-18".`);
  for (const key of ["requiresCore", "testedCore"]) {
    if (m[key] !== undefined && (typeof m[key] !== "string" || !VERSION.test(m[key])))
      fail(`The app "${m.id}" has "${key}": "${m[key]}". Use a core version such as "0.2" or "0.2.0".`);
  }
  for (const key of ["requiresApps", "optionalApps"]) {
    if (m[key] !== undefined && (!Array.isArray(m[key]) || m[key].some((x) => typeof x !== "string" || !ID.test(x))))
      fail(`The app "${m.id}" has "${key}": it must be a list of app ids, such as ["projects"].`);
  }
  return {
    ...m,
    version: typeof pkg.version === "string" ? pkg.version : undefined,
    name: m.name ?? m.id,
    durableObjects: m.durableObjects ?? [],
    enabledByDefault: m.enabledByDefault ?? true,
    scope: m.scope ?? "company",
    requiresApps: m.requiresApps ?? [],
    optionalApps: m.optionalApps ?? []
  };
}

/** Compares two versions such as "0.2" and "0.2.1". Missing parts count as 0. */
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The core version, from packages/core/package.json. */
const coreVersion = () => JSON.parse(readFileSync(CORE_PACKAGE, "utf8")).version;

/** Stops when an app needs a newer core. Warns when the core is newer than the app was tested with. */
function checkCore(loaded) {
  const core = coreVersion();
  for (const a of loaded) {
    if (a.requiresCore && compareVersions(core, a.requiresCore) < 0)
      fail(`The app "${a.id}" needs OpenAct core ${a.requiresCore} or newer. This core is ${core}. Update OpenAct first, then sync again.`);
    // "Tested up to 0.3" covers 0.3.x. Compare only the parts that the app gives.
    if (a.testedCore) {
      const parts = a.testedCore.split(".").length;
      const coreCut = core.split(".").slice(0, parts).join(".");
      if (compareVersions(coreCut, a.testedCore) > 0)
        console.warn(`openact: warning: "${a.id}" was tested up to core ${a.testedCore}. This core is ${core}. Test the app, or get a newer version.`);
    }
  }
}

/** Removes // and /* *\/ comments from JSONC, but not from inside strings, and trailing commas. */
function stripJsonc(text) {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Checks that wrangler.jsonc binds every Durable Object class that the installed apps export, with a migration.
 * A missing binding is a warning: the deploy works, and the app runs without the class or says what it needs.
 * A binding without a migration, or a binding to a class that no app exports, breaks the deploy, so sync stops.
 */
function checkDurableObjects(loaded) {
  if (!existsSync(WRANGLER)) return;
  let config;
  try {
    config = JSON.parse(stripJsonc(readFileSync(WRANGLER, "utf8")));
  } catch (e) {
    console.warn(`openact: warning: could not read wrangler.jsonc to check Durable Objects (${e.message}).`);
    return;
  }
  const bound = new Set((config.durable_objects?.bindings ?? []).map((b) => b.class_name));
  const migrated = new Set(
    (config.migrations ?? []).flatMap((m) => [...(m.new_sqlite_classes ?? []), ...(m.new_classes ?? []), ...(m.renamed_classes ?? []).map((r) => r.to)])
  );
  for (const m of config.migrations ?? []) for (const c of m.deleted_classes ?? []) migrated.delete(c);
  const exported = new Set(CORE_DURABLE_OBJECTS);
  for (const a of loaded) {
    for (const cls of a.durableObjects) {
      exported.add(cls);
      // A class with no binding still deploys. The app works without it, or says what it needs.
      if (!bound.has(cls))
        console.warn(
          `openact: warning: the app "${a.id}" has the Durable Object class ${cls}, but wrangler.jsonc does not bind it. Read the app's docs.\n` +
            `  Add to "durable_objects.bindings": { "name": "<binding from the app's docs>", "class_name": "${cls}" }\n` +
            `  Add to "migrations": { "tag": "<a new tag>", "new_sqlite_classes": ["${cls}"] }`
        );
    }
  }
  for (const cls of bound) {
    // A binding with no migration fails the deploy.
    if (!migrated.has(cls))
      fail(`wrangler.jsonc binds the Durable Object class ${cls}, but no migration creates it.\n  Add to "migrations": { "tag": "<a new tag>", "new_sqlite_classes": ["${cls}"] }`);
    if (!exported.has(cls))
      fail(
        `wrangler.jsonc binds the Durable Object class ${cls}, but no installed app exports it, so the deploy would fail.\n` +
          `  Install the app that has it, or remove the binding. If the class was created before, removing it needs a "deleted_classes" migration, which deletes its stored data.`
      );
  }
}

/** A path for an import in a file inside .openact/. */
const fromOut = (p) => {
  const r = relative(OUT, p).split("\\").join("/");
  return r.startsWith(".") ? r : `./${r}`;
};

/** Checks the "primary" field of openact.apps.json against the installed apps. Returns the id, or null. */
function checkPrimary(reg, loaded) {
  const id = reg.primary ?? null;
  if (id === null) return null;
  if (typeof id !== "string") fail('"primary" in openact.apps.json must be an app id or null.');
  const app = loaded.find((a) => a.id === id);
  if (!app) fail(`"primary" in openact.apps.json is "${id}", but no installed app has that id. Run \`npm run openact -- primary none\` or install the app.`);
  if (!app.client) fail(`"primary" in openact.apps.json is "${id}", but that app has no web code, so it cannot show in the app rail.`);
  return id;
}

async function sync() {
  const reg = readRegistry();
  const { apps } = reg;
  const seen = new Set();
  const loaded = apps.map((entry) => {
    const dir = join(ROOT, entry.path);
    if (!existsSync(dir))
      fail(`The app "${entry.id}" is in openact.apps.json, but ${entry.path} does not exist. Run \`npm run openact -- update ${entry.id}\`.`);
    const m = manifest(dir);
    if (m.id !== entry.id) fail(`openact.apps.json says "${entry.id}", but ${entry.path}/package.json says "${m.id}".`);
    if (seen.has(m.id)) fail(`Two apps use the id "${m.id}".`);
    seen.add(m.id);
    return { ...m, dir, trusted: entry.trusted };
  });
  for (const a of loaded) {
    for (const need of a.requiresApps) {
      if (!seen.has(need))
        fail(`The app "${a.id}" needs the "${need}" app, which is not installed. Run \`npm run openact -- add ${need}\`, or remove "${a.id}".`);
    }
  }

  const primary = checkPrimary(reg, loaded);
  checkCore(loaded);
  checkDurableObjects(loaded);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "migrations"), { recursive: true });
  const header = "// Written by `npm run openact -- sync` from openact.apps.json. Do not edit.\n";

  const server = loaded.filter((a) => a.server);
  writeFileSync(
    join(OUT, "server.ts"),
    header +
      `import type { AppInfo, ServerApp } from "@openact/core/server";\n` +
      server.map((a, i) => `import app${i} from "${fromOut(join(a.dir, a.server))}";\n`).join("") +
      `\nexport const apps: ServerApp[] = [${server.map((_, i) => `app${i}`).join(", ")}];\n` +
      `\n/** Every installed app, also apps with only web code. */\nexport const catalog: AppInfo[] = ${JSON.stringify(
        loaded.map((a) => ({
          id: a.id,
          name: a.name,
          enabledByDefault: a.enabledByDefault,
          scope: a.scope,
          ...(a.version ? { version: a.version } : {}),
          ...(a.plan ? { plan: a.plan } : {}),
          ...(a.plan && a.released ? { released: a.released } : {}),
          ...(a.trusted === "manual" ? { reviewed: false } : {})
        }))
      )};\n`
  );
  writeFileSync(
    join(OUT, "durable-objects.ts"),
    header +
      loaded
        .filter((a) => a.durableObjects.length)
        .map((a) => `export { ${a.durableObjects.join(", ")} } from "${fromOut(join(a.dir, a.server))}";\n`)
        .join("") +
      "export {};\n"
  );

  const client = loaded.filter((a) => a.client);
  writeFileSync(
    join(OUT, "client.tsx"),
    header +
      `import type { ClientApp } from "@openact/ui";\n` +
      client.map((a, i) => `import app${i} from "${fromOut(join(a.dir, a.client))}";\n`).join("") +
      `\nexport const apps: ClientApp[] = [${client.map((_, i) => `app${i}`).join(", ")}];\n` +
      `\n/** The primary app: it goes at the top of the app rail, above a divider. Null when there is none. */\nexport const primary: string | null = ${JSON.stringify(primary)};\n`
  );
  writeFileSync(
    join(OUT, "sources.css"),
    "/* Written by `npm run openact -- sync`. Tailwind scans these app folders for class names. */\n" +
      loaded.map((a) => `@source "${fromOut(a.dir)}";\n`).join("")
  );

  // Migrations: the core's first, under their own names, then each app's with its id in front.
  // Wrangler applies the ones that are new, in name order. App tables may use core tables, never the other way.
  let count = 0;
  for (const f of readdirSync(CORE_MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    cpSync(join(CORE_MIGRATIONS, f), join(OUT, "migrations", f));
    count++;
  }
  for (const a of loaded) {
    const dir = join(a.dir, a.migrations ?? "migrations");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      cpSync(join(dir, f), join(OUT, "migrations", `${a.id}_${f}`));
      count++;
    }
  }
  // Run every migration on an empty database, and check new names against docs/naming.md.
  let schema;
  try {
    schema = await checkSchema({ dir: join(OUT, "migrations"), apps: loaded.map((a) => a.id), strict: process.env.OPENACT_STRICT === "1" });
  } catch (e) {
    fail(e.message);
  }
  if (schema.skipped) console.warn(`openact: ${schema.skipped}`);
  for (const w of schema.warnings) console.warn(`openact: naming: ${w}`);
  console.log(
    `openact: ${loaded.length} ${loaded.length === 1 ? "app" : "apps"} (${loaded.map((a) => a.id).join(", ") || "none"}), ${count} migrations` +
      (primary ? `, primary app "${primary}".` : ".")
  );
}

/**
 * Copies an app from GitHub into a new temporary folder. Returns the folder.
 * github:owner/repo is an app at the top of the repository. github:owner/repo/apps/docs is one app in a repository with several.
 */
function fetchFromGitHub(source) {
  const m = /^github:([\w.-]+)\/([\w.-]+?)(?:\.git)?((?:\/[\w.-]+)*)(?:#(.+))?$/.exec(source);
  if (!m) fail(`Use github:owner/repo, github:owner/repo/path/to/app or add #tag. "${source}" does not match.`);
  const [, owner, repo, sub, ref] = m;
  if (sub.split("/").some((part) => part === "." || part === "..")) fail(`The path in "${source}" must stay inside the repository.`);
  const tmp = mkdtempSync(join(tmpdir(), "openact-app-"));
  temps.push(tmp);
  const args = ["clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), `https://github.com/${owner}/${repo}.git`, tmp];
  try {
    execFileSync("git", args, { stdio: ["ignore", "inherit", "inherit"] });
  } catch {
    const paid = readDirectory().apps.find((a) => a.plan && baseSource(a.source) === `github:${owner}/${repo}${sub}`);
    fail(
      paid
        ? `git could not copy ${owner}/${repo}. ${paid.name} is a paid app in a private repository. Ask MarketGrowth for access with your license, then make sure git can sign in to GitHub on this computer. See https://docs.openact.ing/plans#get-the-director-apps`
        : `git could not copy ${owner}/${repo}${ref ? ` at ${ref}` : ""}. Check the name and the tag, and that git can sign in to GitHub for private repositories.`
    );
  }
  rmSync(join(tmp, ".git"), { recursive: true, force: true });
  const label = `${owner}/${repo}${sub}${ref ? `#${ref}` : ""}`;
  if (!sub) return { dir: tmp, source: `github:${owner}/${repo}`, ref: ref ?? null, label };
  // Keep only the app's folder.
  const from = join(tmp, sub);
  if (!existsSync(join(from, "package.json"))) fail(`${label} is not an app folder. It needs a package.json with an "openact" field.`);
  const only = mkdtempSync(join(tmpdir(), "openact-app-"));
  temps.push(only);
  cpSync(from, only, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });
  return { dir: only, source: `github:${owner}/${repo}${sub}`, ref: ref ?? null, label };
}

/** Copies an app from a folder on this computer into a new temporary folder. */
function fetchFromPath(source) {
  const from = resolve(ROOT, source.replace(/^path:/, ""));
  if (!existsSync(join(from, "package.json"))) fail(`${source} is not an app folder. It needs a package.json with an "openact" field.`);
  const tmp = mkdtempSync(join(tmpdir(), "openact-app-"));
  temps.push(tmp);
  cpSync(from, tmp, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(relative(from, p) ? "/" + relative(from, p) : "") });
  const rel = relative(ROOT, from).split("\\").join("/");
  return { dir: tmp, source: `path:${rel}`, ref: null, label: rel };
}

const isPath = (s) => /^(\.{1,2}\/|\/|path:)/.test(s);
const isBareId = (s) => ID.test(s);
function fetchApp(source) {
  if (isBareId(source)) source = directorySource(source);
  return isPath(source) ? fetchFromPath(source) : fetchFromGitHub(source);
}

async function install(fetched, expectId) {
  const m = manifest(fetched.dir, fetched.label);
  if (expectId && m.id !== expectId) fail(`The repository now holds the app "${m.id}", not "${expectId}".`);
  checkReserved(m, fetched);
  checkTrust(m, fetched);
  const target = join(ROOT, "apps", m.id);
  rmSync(target, { recursive: true, force: true });
  cpSync(fetched.dir, target, { recursive: true });
  rmSync(fetched.dir, { recursive: true, force: true });
  const reg = readRegistry();
  const reviewed = fetched.source.startsWith("path:") || isReviewed(m, fetched);
  const entry = { id: m.id, path: `apps/${m.id}`, source: fetched.source, ...(fetched.ref ? { ref: fetched.ref } : {}), ...(reviewed ? {} : { trusted: "manual" }) };
  const i = reg.apps.findIndex((a) => a.id === m.id);
  if (i >= 0) reg.apps[i] = entry;
  else reg.apps.push(entry);
  writeRegistry(reg);
  await sync();
  return m;
}

const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const [cmd, arg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
switch (cmd) {
  case "sync":
    await sync();
    break;
  case "list": {
    const { apps, primary } = readRegistry();
    if (!apps.length) console.log("No apps are installed.");
    for (const a of apps)
      console.log(
        `${a.id.padEnd(16)} ${a.path.padEnd(22)} ${a.source}${a.ref ? `#${a.ref}` : ""}${a.id === primary ? "  (primary)" : ""}${a.trusted === "manual" ? "  (not reviewed, full access)" : ""}`
      );
    break;
  }
  case "directory": {
    const { apps } = readDirectory();
    const installed = new Set(readRegistry().apps.map((a) => a.id));
    const label = { "built-in": "built in", available: "available", planned: "planned", example: "example" };
    for (const a of apps) {
      const state = installed.has(a.id) ? "installed" : label[a.status] ?? a.status;
      const plan = a.plan ? PLAN_NAMES[a.plan] ?? a.plan : "";
      console.log(`${a.id.padEnd(12)} ${state.padEnd(10)} ${plan.padEnd(9)} ${a.name.padEnd(18)} ${a.summary}`);
    }
    if (apps.some((a) => a.plan)) console.log("\nDirector and Producer apps need a paid plan. Read https://docs.openact.app/plans");
    console.log("\nInstall an app with: npm run openact -- add <id>. Read more at https://docs.openact.app/directory");
    break;
  }
  case "add": {
    if (!arg) fail("Say which app to add, for example: npm run openact -- add contacts, or add github:owner/repo");
    const reg = readRegistry();
    const fetched = fetchApp(arg);
    const m = manifest(fetched.dir, fetched.label);
    if (reg.apps.some((a) => a.id === m.id)) {
      rmSync(fetched.dir, { recursive: true, force: true });
      fail(`An app with the id "${m.id}" is already installed. Use update to get a new version.`);
    }
    await install(fetched);
    console.log(`openact: added "${m.name}" in apps/${m.id}. Next: run npm install, then npm run deploy (or npm run dev).`);
    break;
  }
  case "update": {
    const entry = readRegistry().apps.find((a) => a.id === arg);
    if (!entry) fail(`No installed app has the id "${arg}". Run npm run openact -- list.`);
    if (entry.source === "local") fail(`"${arg}" is part of this repository. Change its code in ${entry.path} directly.`);
    if (entry.source === "director")
      fail(`"${arg}" is a Director app from the OpenAct store. Update it in the app: Settings > Site settings > Plan > Install or update apps.`);
    const m = await install(fetchApp(`${entry.source}${entry.ref ? `#${entry.ref}` : ""}`), entry.id);
    console.log(`openact: updated "${m.name}". Next: run npm install, then npm run deploy (or npm run dev).`);
    break;
  }
  case "remove": {
    const reg = readRegistry();
    const entry = reg.apps.find((a) => a.id === arg);
    if (!entry) fail(`No installed app has the id "${arg}".`);
    reg.apps = reg.apps.filter((a) => a.id !== arg);
    if (reg.primary === arg) delete reg.primary;
    writeRegistry(reg);
    if (entry.source !== "local") rmSync(join(ROOT, entry.path), { recursive: true, force: true });
    await sync();
    console.log(`openact: removed "${arg}". Its tables stay in the database, so you can add it again later without data loss.`);
    break;
  }
  case "primary": {
    if (!arg) fail("Say which app is the primary app, for example: npm run openact -- primary orbytt. Use primary none to remove it.");
    const reg = readRegistry();
    if (arg === "none") {
      delete reg.primary;
      writeRegistry(reg);
      await sync();
      console.log("openact: no primary app. The app rail shows the apps in install order.");
      break;
    }
    if (!reg.apps.some((a) => a.id === arg)) fail(`No installed app has the id "${arg}". Run npm run openact -- list.`);
    // Keep "primary" after "$comment" and before "apps", so the file reads in order.
    const { $comment, apps, ...rest } = reg;
    writeRegistry({ ...($comment ? { $comment } : {}), ...rest, primary: arg, apps });
    await sync();
    console.log(`openact: "${arg}" is the primary app. Next: npm run deploy (or npm run dev).`);
    break;
  }
  default:
    console.log(
      "Usage: npm run openact -- list | directory | add <id> [--trust] | add github:owner/repo[/path][#ref] [--trust] | add ./folder | update <id> [--trust] | remove <id> | primary <id|none> | sync"
    );
    if (cmd) process.exit(1);
}
