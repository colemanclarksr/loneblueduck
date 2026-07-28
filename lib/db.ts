import { PrismaClient } from "@/lib/generated/prisma";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Next dev reloads modules on every edit; without the global cache each reload
// opens another connection until the process runs out of handles.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function client() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
  });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? client();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
