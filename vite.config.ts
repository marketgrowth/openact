import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Vite builds the web app into dist/client. Wrangler serves it as static assets.
// For hot reload: run `npx wrangler dev` in one terminal and `npm run dev:ui` in another.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/client", import.meta.url)) }
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787"
    }
  }
});
