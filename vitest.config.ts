import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: "./tests/global-setup.ts",
    pool: "forks",
    // SQLite takes a database-wide lock on write, so parallel test files make
    // each other's transactions time out rather than fail honestly. Production
    // is Postgres (blueprint §9) and has no such limit; this constraint belongs
    // to the local test database only.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
