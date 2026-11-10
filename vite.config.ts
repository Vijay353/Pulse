import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = "http://127.0.0.1:8787";
export default defineConfig({
  root: "apps/web",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    proxy: Object.fromEntries(["/api", "/mock-pos", "/mock-ads", "/v1", "/policies", "/approvals"].map((p) => [p, api])),
  },
});
