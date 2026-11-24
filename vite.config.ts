import { createHash } from "node:crypto";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vite builds the web app into dist/client. Wrangler serves it as static assets.
// For hot reload: run `npx wrangler dev` in one terminal and `npm run dev:ui` in another.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  css: {
    modules: {
      // Arc components (packages/ui/src/arc) get an `arc_` class prefix. Their keyboard focus rule in arc.css finds them by it.
      generateScopedName: (name, filename) => {
        const file = filename.replace(/\\/g, "/").split("/").pop()?.replace(/\.module\.css.*$/, "") ?? "m";
        const hash = createHash("sha256").update(filename.replace(/\\/g, "/").split("/packages/").pop() ?? filename).digest("base64url").slice(0, 5);
        return `${filename.replace(/\\/g, "/").includes("/packages/ui/src/arc/") ? "arc_" : ""}${file}_${name}_${hash}`;
      }
    }
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    // No source maps in the public build. The Worker's source maps go to Cloudflare only (upload_source_maps).
    sourcemap: false
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787"
    }
  }
});
