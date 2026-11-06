// Creates the Vectorize index and its metadata index for OpenAct search by meaning.
// Safe to run more than once: "already exists" errors are ignored.
import { spawnSync } from "node:child_process";

const INDEX = "openact-tasks";
const steps = [
  ["vectorize", "create", INDEX, "--dimensions=768", "--metric=cosine"],
  ["vectorize", "create-metadata-index", INDEX, "--property-name=project_id", "--type=string"]
];

for (const args of steps) {
  const r = spawnSync("npx", ["wrangler", ...args], { encoding: "utf8", shell: process.platform === "win32" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status === 0) console.log(`OK: wrangler ${args.join(" ")}`);
  else if (/already exists|duplicate/i.test(out)) console.log(`Already set up: wrangler ${args.join(" ")}`);
  else {
    console.error(out);
    console.error(`Failed: wrangler ${args.join(" ")}. Search still works with words only. Fix the error, then run npm run search:setup again.`);
  }
}
