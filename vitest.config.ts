import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Each file gets its own database file, so suites cannot see each other's
    // rows and can run in parallel.
    environment: "node",
    globalSetup: "./tests/global-setup.ts",
    pool: "forks",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
