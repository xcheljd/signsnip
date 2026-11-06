import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: path.join(__dirname, "web"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.join(__dirname, "web/src") } },
  server: { port: 7048, host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:7047" } },
  build: { outDir: path.join(__dirname, "web/dist"), emptyOutDir: true },
});
