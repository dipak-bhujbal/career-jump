import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/**/__tests__/**/*.test.ts",
      "src/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    environment: "node",
    globals: false,
    coverage: {
      provider: "v8",
      include: ["src/ats/**/*.ts", "src/jobs/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.test.ts", "**/__fixtures__/**"],
      reporter: ["text", "html"],
    },
  },
});
