import { test } from "node:test";
import assert from "node:assert/strict";
import { isSettingsPath } from "../packages/ui/src/app-paths.ts";
import { COMPANY_SECTIONS, companySections, parseSettingsPath, settingsPath } from "../packages/ui/src/settings-paths.ts";

test("settings paths belong to the shell", () => {
  assert.equal(isSettingsPath("/settings"), true);
  assert.equal(isSettingsPath("/settings/company/people"), true);
  assert.equal(isSettingsPath("/settingsx"), false);
  assert.equal(isSettingsPath("/p/abc"), false);
});

test("each section has its own path", () => {
  assert.equal(settingsPath("company", "people"), "/settings/company/people");
  assert.equal(settingsPath("company", "projects.ai"), "/settings/company/projects.ai");
  assert.equal(settingsPath("site", "sign-in"), "/settings/site/sign-in");
});

test("a settings path reads back to its section", () => {
  assert.deepEqual(parseSettingsPath("/settings"), {});
  assert.deepEqual(parseSettingsPath("/settings/"), {});
  assert.deepEqual(parseSettingsPath("/settings/company"), { scope: "company", id: undefined });
  assert.deepEqual(parseSettingsPath("/settings/company/ai/"), { scope: "company", id: "ai" });
  assert.deepEqual(parseSettingsPath("/settings/site/apps"), { scope: "site", id: "apps" });
  assert.equal(parseSettingsPath("/settings/other/apps"), null);
  assert.equal(parseSettingsPath("/settings/company/a/b"), null);
  assert.equal(parseSettingsPath("/settings/company/%E0%A4%A"), null);
});

test("apps add company sections after the built-in ones", () => {
  const apps = [
    { icon: "projects", companySettingsTabs: [{ id: "projects.ai", label: "AI defaults" }] },
    { icon: "doc", companySettingsTabs: [{ id: "docs", label: "Docs" }, { id: "people", label: "Clash" }] },
    {}
  ];
  const ids = companySections(apps).map((s) => s.id);
  assert.deepEqual(ids, [...COMPANY_SECTIONS.map((s) => s.id), "projects.ai", "docs"]);
  assert.equal(companySections(apps).find((s) => s.id === "docs")?.icon, "doc");
});
