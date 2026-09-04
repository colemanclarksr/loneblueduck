import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.resolve(process.cwd(), "prisma/test.db");

// A schema-fresh database per run, so a stale column or a half-applied
// migration can never make a test pass for the wrong reason.
export default function setup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(TEST_DB + suffix, { force: true });
  }
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
  });
}
