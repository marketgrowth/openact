// Astro builds the openact.ing pages into dist/. The openact-site Worker (worker/index.ts) serves dist/.
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import noOrphans from "./integrations/no-orphans.mjs";

export default defineConfig({
  site: "https://openact.ing",
  integrations: [noOrphans()],
  output: "static",
  // contribute.astro becomes contribute.html, served at /contribute. The rules in public/_headers match these paths.
  build: { format: "file", inlineStylesheets: "never" },
  trailingSlash: "never",
  devToolbar: { enabled: false },
  // Keep media queries in the older (max-width: ...) form, so Safari before 16.4 reads them.
  // assetsInlineLimit 0: Astro writes every script to /_astro/ as a file. The rules in public/_headers allow only scripts from this site, not inline ones.
  vite: { plugins: [tailwindcss()], build: { assetsInlineLimit: 0, cssTarget: ["chrome100", "safari14", "firefox100"] } }
});
