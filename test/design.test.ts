import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error The design tools are plain JavaScript with no type file.
import { build, check, contrast, loadBook, loadTheme, parseColor, seed } from "../scripts/design-lib.mjs";

test("every Promptbook cue that a script can check passes", () => {
  const problems = check() as { cue: string; text: string }[];
  assert.deepEqual(problems.map((p) => `${p.cue} ${p.text}`), []);
});

test("the published Promptbook at openact.ing/design is up to date", () => {
  assert.deepEqual(build({ dryRun: true }), [], "Run npm run design -- build.");
});

test("contrast math matches known values", () => {
  assert.equal(Number(contrast("#000000", "#ffffff").toFixed(1)), 21);
  assert.equal(Number(contrast("#777777", "#ffffff").toFixed(2)), 4.48);
  assert.equal(Number(contrast("oklch(1 0 0)", "#ffffff").toFixed(2)), 1);
  assert.equal(parseColor("var(--x)"), null);
});

test("a seed makes app accents that pass contrast in both themes", () => {
  const theme = loadTheme();
  for (const hue of [0, 60, 120, 160, 220, 265, 320]) {
    const s = seed("advisory", hue, { theme });
    for (const mode of ["light", "dark"] as const) {
      const v = s[mode];
      const surfaces = mode === "light" ? [theme.light.background, theme.light.card] : [theme.dark.background, theme.dark.card];
      for (const bg of surfaces) assert.ok(contrast(v.hex, bg) >= 4.5, `hue ${hue} ${mode}`);
      assert.ok(contrast(v.ink, v.hex) >= 4.5, `ink on hue ${hue} ${mode}`);
    }
    assert.match(s.css, /--app-advisory-accent:/);
  }
});

test("a seed refuses a bad app id or hue", () => {
  assert.throws(() => seed("My App", 120), /app id/);
  assert.throws(() => seed("docs", 400), /hue/);
});

test("the agent states are the five that the UI kit draws", () => {
  const book = loadBook();
  assert.deepEqual(book.agentStates.map((s: { id: string }) => s.id), ["think", "act", "wait", "done", "fail"]);
  for (const s of book.agentStates) assert.ok(`agent-${s.id}` in book.tokens.agent.items);
});
