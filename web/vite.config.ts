import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ["localhost", "127.0.0.1", ".trycloudflare.com"],
    fs: { allow: [".."] },
    proxy: {
      "/api": "http://localhost:8080",
      "/internal": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
