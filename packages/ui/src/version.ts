/*
 * The OpenAct version that this build runs. Vite writes it from packages/core/package.json (see vite.config.ts).
 * Tests and tools that do not run through Vite get "dev".
 */
declare const __OPENACT_VERSION__: string | undefined;

export const OPENACT_VERSION: string = typeof __OPENACT_VERSION__ === "string" ? __OPENACT_VERSION__ : "dev";

/** Where a site owner finds new releases and update notes. */
export const OPENACT_RELEASES_URL = "https://github.com/marketgrowth/openact/releases";
