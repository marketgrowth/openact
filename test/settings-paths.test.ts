import { test } from "node:test";
import assert from "node:assert/strict";
import { isSettingsPath } from "../packages/ui/src/app-paths.ts";
import { COMPANY_SECTIONS, appSections, companySections, isAppSection, parseSettingsPath, settingsPath } from "../packages/ui/src/settings-paths.ts";

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
  assert.deepEqual(parseSettingsPath("/settings/account/profile"), { scope: "account", id: "profile" });
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

test("app sections are listed apart from the company sections", () => {
  const apps = [
    { icon: "doc", companySettingsTabs: [{ id: "docs", label: "Docs" }, { id: "general", label: "Clash" }] },
    { icon: "handshake", companySettingsTabs: [{ id: "advisory", label: "Advisory" }, { id: "docs", label: "Twice" }] }
  ];
  const tabs = appSections(apps);
  assert.deepEqual(tabs.map((s) => s.id), ["docs", "advisory"]);
  assert.equal(tabs.every((s) => s.scope === "company"), true);
  assert.equal(tabs.every(isAppSection), true);
  assert.equal(COMPANY_SECTIONS.some(isAppSection), false);
  assert.equal(settingsPath(tabs[1].scope, tabs[1].id), "/settings/company/advisory");
});

test("the first site section is Branding, at the same path as before", async () => {
  const { SITE_SECTIONS } = await import("../packages/ui/src/settings-paths.ts");
  assert.equal(SITE_SECTIONS[0].id, "general");
  assert.equal(SITE_SECTIONS[0].label, "Branding");
  assert.equal(settingsPath("site", SITE_SECTIONS[0].id), "/settings/site/general");
});

test("the Submit issues link must be a full web link", async () => {
  const { cleanLegalUrl } = await import("../packages/core/src/shared/site.ts");
  assert.deepEqual(cleanLegalUrl("https://github.com/acme/app/issues/new", "Submit issues"), { url: "https://github.com/acme/app/issues/new" });
  assert.deepEqual(cleanLegalUrl("  ", "Submit issues"), { url: "" });
  assert.match((cleanLegalUrl("javascript:alert(1)", "Submit issues") as { problem: string }).problem, /Submit issues link must start with https/);
  assert.match((cleanLegalUrl("github.com/issues", "Submit issues") as { problem: string }).problem, /full web address/);
});
