import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "127.0.0.1",
    open: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4174",
        changeOrigin: true
      }
    }
  },
  build: { outDir: "renderer-dist" }
});
