import path from "node:path";
import { PrismaClient } from "@/lib/generated/prisma";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Next dev reloads modules on every edit; without the global cache each reload
// opens another connection until the process runs out of handles.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Resolves the database URL to an absolute path.
 *
 * A relative `file:./prisma/dev.db` is interpreted against the process's
 * working directory, which differs between the Prisma CLI, the dev server and
 * the built server. When they disagree SQLite silently creates a second, empty
 * file rather than failing, and every query then dies with "table does not
 * exist" against a database that looks fine on disk.
 */
export function resolveDatabaseUrl(raw = process.env.DATABASE_URL): string {
  const url = raw ?? "file:./prisma/dev.db";
  if (!url.startsWith("file:")) return url; // Postgres and friends pass through

  const target = url.slice("file:".length);
  if (target.startsWith("/")) return `file:${target}`;
  return `file:${path.resolve(process.cwd(), target)}`;
}

function client() {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: resolveDatabaseUrl() }),
  });
}

export const db = globalForPrisma.prisma ?? client();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
