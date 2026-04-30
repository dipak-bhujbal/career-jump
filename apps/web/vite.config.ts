import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

const apiTarget = process.env.VITE_API_URL || "http://localhost:3000";
// Expose the shipped web version to the client so Profile can show exactly
// which release is running in the current deployment.
const appVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version ?? "0.0.0";

export default defineConfig({
  define: {
    global: "globalThis",
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
  },
  plugins: [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true, secure: false },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: [
      // Route and component tests are commonly authored in TSX, so keep the
      // include globs broad enough that explicit React regression tests run.
      "src/**/__tests__/**/*.test.{ts,tsx}",
      "src/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
    ],
  },
});
