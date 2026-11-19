import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STORE_URL, newerVersion } from "../packages/core/src/shared/store.ts";
import { deployLicenseSource } from "../packages/core/src/server/license.ts";

test("the store has a newer version only when its version is higher", () => {
  assert.equal(newerVersion("0.2.0", null), true);
  assert.equal(newerVersion("0.2.0", "0.1.9"), true);
  assert.equal(newerVersion("0.2.0", "0.2.0"), false);
  assert.equal(newerVersion("0.2", "0.2.0"), false);
  assert.equal(newerVersion("0.1.10", "0.2.0"), false);
  assert.equal(DEFAULT_STORE_URL, "https://on.openact.ing");
});

/** A D1 stand-in with no saved settings. */
const emptyDb = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) };

test("a deploy without any key has no license, and the secret alone is its source", async () => {
  assert.equal(await deployLicenseSource({ DB: emptyDb } as never), null);
  const r = await deployLicenseSource({ DB: emptyDb, OPENACT_LICENSE: "oa1.not.valid" } as never);
  assert.equal(r?.source, "secret");
  assert.equal(r?.result.ok, false);
});

test("a deploy before the site settings table exists still reads the secret", async () => {
  const noTable = { prepare: () => ({ bind: () => ({ all: async () => Promise.reject(new Error("D1_ERROR: no such table: site_settings")) }) }) };
  const r = await deployLicenseSource({ DB: noTable, OPENACT_LICENSE: "oa1.not.valid" } as never);
  assert.equal(r?.source, "secret");
});
