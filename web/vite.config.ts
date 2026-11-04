import { defineConfig } from "vite";

const api = process.env.API_URL ?? "http://localhost:8000";

export default defineConfig({
  server: { proxy: { "/api": api, "/mcp": api, "/oauth": api, "/.well-known": api } },
  build: { chunkSizeWarningLimit: 2000 },
});
