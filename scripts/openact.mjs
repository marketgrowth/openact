#!/usr/bin/env node
/*
 * The OpenAct app tool.
 *
 *   npm run openact -- list                          Shows the installed apps.
 *   npm run openact -- add github:owner/repo[#ref]   Copies an app from GitHub into apps/<id> and installs it.
 *   npm run openact -- add ./path/to/app            Copies an app from a folder on this computer, for example while you build it.
 *   npm run openact -- update <id>                   Copies the app again from where it came from.
 *   npm run openact -- remove <id>                   Removes the app from this OpenAct. Its tables stay in the database.
 *   npm run openact -- sync                          Writes the files in .openact/ from openact.apps.json.
 *
 * An app is a folder with a package.json that has an "openact" field:
 *   { "id": "orbytt", "name": "Orbytt", "server": "./src/server/index.ts", "client": "./src/client/index.tsx",
 *     "migrations": "./migrations", "durableObjects": ["GroupRoom"], "enabledByDefault": true }
 *
 * "enabledByDefault": false makes each company turn the app on in Company settings before it shows.
 *
 * Like shadcn/ui, `add` copies the app's code into your repository. You own it, and you can read and change it.
 * `update` replaces the folder, so keep your own changes in git or send them to the app's authors.
 * Private repositories work when git can sign in to GitHub on this computer.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const REGISTRY = join(ROOT, "openact.apps.json");
const OUT = join(ROOT, ".openact");
const CORE_MIGRATIONS = join(ROOT, "packages/core/migrations");
const ID = /^[a-z][a-z0-9-]{1,30}$/;

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
  return { ...m, name: m.name ?? m.id, durableObjects: m.durableObjects ?? [], enabledByDefault: m.enabledByDefault ?? true };
}

/** A path for an import in a file inside .openact/. */
const fromOut = (p) => {
  const r = relative(OUT, p).split("\\").join("/");
  return r.startsWith(".") ? r : `./${r}`;
};

function sync() {
  const { apps } = readRegistry();
  const seen = new Set();
  const loaded = apps.map((entry) => {
    const dir = join(ROOT, entry.path);
    if (!existsSync(dir))
      fail(`The app "${entry.id}" is in openact.apps.json, but ${entry.path} does not exist. Run \`npm run openact -- update ${entry.id}\`.`);
    const m = manifest(dir);
    if (m.id !== entry.id) fail(`openact.apps.json says "${entry.id}", but ${entry.path}/package.json says "${m.id}".`);
    if (seen.has(m.id)) fail(`Two apps use the id "${m.id}".`);
    seen.add(m.id);
    return { ...m, dir };
  });

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
        loaded.map((a) => ({ id: a.id, name: a.name, enabledByDefault: a.enabledByDefault }))
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
      `\nexport const apps: ClientApp[] = [${client.map((_, i) => `app${i}`).join(", ")}];\n`
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
  console.log(`openact: ${loaded.length} ${loaded.length === 1 ? "app" : "apps"} (${loaded.map((a) => a.id).join(", ") || "none"}), ${count} migrations.`);
}

/** Copies an app from GitHub into a new temporary folder. Returns the folder. */
function fetchFromGitHub(source) {
  const m = /^github:([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:#(.+))?$/.exec(source);
  if (!m) fail(`Use github:owner/repo or github:owner/repo#tag. "${source}" does not match.`);
  const [, owner, repo, ref] = m;
  const tmp = mkdtempSync(join(tmpdir(), "openact-app-"));
  temps.push(tmp);
  const args = ["clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), `https://github.com/${owner}/${repo}.git`, tmp];
  try {
    execFileSync("git", args, { stdio: ["ignore", "inherit", "inherit"] });
  } catch {
    fail(
      `git could not copy ${owner}/${repo}${ref ? ` at ${ref}` : ""}. Check the name and the tag, and that git can sign in to GitHub for private repositories.`
    );
  }
  rmSync(join(tmp, ".git"), { recursive: true, force: true });
  return { dir: tmp, source: `github:${owner}/${repo}`, ref: ref ?? null, label: `${owner}/${repo}${ref ? `#${ref}` : ""}` };
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
const fetchApp = (source) => (isPath(source) ? fetchFromPath(source) : fetchFromGitHub(source));

function install(fetched, expectId) {
  const m = manifest(fetched.dir, fetched.label);
  if (expectId && m.id !== expectId) fail(`The repository now holds the app "${m.id}", not "${expectId}".`);
  const target = join(ROOT, "apps", m.id);
  rmSync(target, { recursive: true, force: true });
  cpSync(fetched.dir, target, { recursive: true });
  rmSync(fetched.dir, { recursive: true, force: true });
  const reg = readRegistry();
  const entry = { id: m.id, path: `apps/${m.id}`, source: fetched.source, ...(fetched.ref ? { ref: fetched.ref } : {}) };
  const i = reg.apps.findIndex((a) => a.id === m.id);
  if (i >= 0) reg.apps[i] = entry;
  else reg.apps.push(entry);
  writeRegistry(reg);
  sync();
  return m;
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case "sync":
    sync();
    break;
  case "list": {
    const { apps } = readRegistry();
    if (!apps.length) console.log("No apps are installed.");
    for (const a of apps) console.log(`${a.id.padEnd(16)} ${a.path.padEnd(22)} ${a.source}${a.ref ? `#${a.ref}` : ""}`);
    break;
  }
  case "add": {
    if (!arg) fail("Say which app to add, for example: npm run openact -- add github:owner/repo");
    const reg = readRegistry();
    const fetched = fetchApp(arg);
    const m = manifest(fetched.dir, fetched.label);
    if (reg.apps.some((a) => a.id === m.id)) {
      rmSync(fetched.dir, { recursive: true, force: true });
      fail(`An app with the id "${m.id}" is already installed. Use update to get a new version.`);
    }
    install(fetched);
    console.log(`openact: added "${m.name}" in apps/${m.id}. Next: run npm install, then npm run deploy (or npm run dev).`);
    break;
  }
  case "update": {
    const entry = readRegistry().apps.find((a) => a.id === arg);
    if (!entry) fail(`No installed app has the id "${arg}". Run npm run openact -- list.`);
    if (entry.source === "local") fail(`"${arg}" is part of this repository. Change its code in ${entry.path} directly.`);
    const m = install(fetchApp(`${entry.source}${entry.ref ? `#${entry.ref}` : ""}`), entry.id);
    console.log(`openact: updated "${m.name}". Next: run npm install, then npm run deploy (or npm run dev).`);
    break;
  }
  case "remove": {
    const reg = readRegistry();
    const entry = reg.apps.find((a) => a.id === arg);
    if (!entry) fail(`No installed app has the id "${arg}".`);
    reg.apps = reg.apps.filter((a) => a.id !== arg);
    writeRegistry(reg);
    if (entry.source !== "local") rmSync(join(ROOT, entry.path), { recursive: true, force: true });
    sync();
    console.log(`openact: removed "${arg}". Its tables stay in the database, so you can add it again later without data loss.`);
    break;
  }
  default:
    console.log("Usage: npm run openact -- list | add github:owner/repo[#ref] | add ./folder | update <id> | remove <id> | sync");
    if (cmd) process.exit(1);
}
