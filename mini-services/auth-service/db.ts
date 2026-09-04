// Singleton Prisma client for auth-service.
// Points at the shared SQLite DB; auth-service OWNS only the User + AuthAudit tables.
import { PrismaClient } from "@prisma/client";
import path from "path";

// Windows & cross-platform safe absolute path to db/custom.db
const resolvedDbPath = path.resolve(__dirname, "../../db/custom.db").replace(/\\/g, "/");
const databaseUrl = process.env.DATABASE_URL || `file:${resolvedDbPath}`;

// Reuse the same client on hot reloads (Bun --hot) to avoid exhausting connections.
const globalForPrisma = globalThis as unknown as { __authPrisma?: PrismaClient };

export const db =
  globalForPrisma.__authPrisma ??
  new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: process.env.PRISMA_LOG ? ["query", "error", "warn"] : ["error"],
  });

if (!globalForPrisma.__authPrisma) {
  globalForPrisma.__authPrisma = db;
}