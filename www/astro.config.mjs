// Astro builds the openact.ing pages into dist/. The openact-site Worker (worker/index.ts) serves dist/.
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://openact.ing",
  output: "static",
  // contribute.astro becomes contribute.html, served at /contribute. The rules in public/_headers match these paths.
  build: { format: "file", inlineStylesheets: "never" },
  trailingSlash: "never",
  devToolbar: { enabled: false },
  // Keep media queries in the older (max-width: ...) form, so Safari before 16.4 reads them.
  vite: { build: { cssTarget: ["chrome100", "safari14", "firefox100"] } }
});
