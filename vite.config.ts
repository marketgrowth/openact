import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vite builds the web app into dist/client. Wrangler serves it as static assets.
// For hot reload: run `npx wrangler dev` in one terminal and `npm run dev:ui` in another.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
