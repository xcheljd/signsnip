import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { port: 7048, host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:7047" } },
  build: { outDir: path.join(__dirname, "dist"), emptyOutDir: true },
});
