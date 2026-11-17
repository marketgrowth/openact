#!/usr/bin/env node
// The OpenAct Promptbook command. See docs/design-system.md.
//   npm run design -- check              Test the cues that a script can test.
//   npm run design -- seed <app-id> <hue> Make an app accent from one hue (0 to 360).
//   npm run design -- build              Publish the Promptbook to www/public/design and www/src/pages/design.astro.
import { check, seed, build } from "./design-lib.mjs";

const [cmd = "check", ...args] = process.argv.slice(2);

if (cmd === "check") {
  const problems = check();
  if (problems.length === 0) {
    console.log("Promptbook: every script cue passes.");
  } else {
    for (const p of problems) console.log(`${p.cue}  ${p.text}`);
    console.log(`\nPromptbook: ${problems.length} problem${problems.length === 1 ? "" : "s"}. Fix them, then run the check again.`);
    process.exitCode = 1;
  }
} else if (cmd === "seed") {
  const [id, hue, chroma] = args;
  if (!id || hue === undefined) {
    console.log("Usage: npm run design -- seed <app-id> <hue> [chroma]\nExample: npm run design -- seed advisory 160");
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(seed(id, hue, chroma ? { chroma: Number(chroma) } : {}).css);
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    }
  }
} else if (cmd === "build") {
  const stale = build({ dryRun: args.includes("--check") });
  if (args.includes("--check") && stale.length) {
    console.log(`These files are out of date: ${stale.join(", ")}. Run npm run design -- build.`);
    process.exitCode = 1;
  } else {
    console.log(stale.length ? `Wrote ${stale.join(", ")}.` : "The published Promptbook is up to date.");
  }
} else {
  console.log("Commands: check, seed <app-id> <hue>, build");
  process.exitCode = 1;
}
