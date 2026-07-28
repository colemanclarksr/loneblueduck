import { defineConfig } from "vitest/config";
import path from "node:path";

const TEST_DB = `file:${path.resolve(__dirname, "prisma/test.db")}`;

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
    // Points the application's own db singleton at the test database. Without
    // this, code under test writes to dev.db while the fixtures write to
    // test.db, and every assertion fails for a reason that has nothing to do
    // with the code.
    env: { DATABASE_URL: TEST_DB },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
