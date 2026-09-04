import { PrismaClient } from "@prisma/client";
import path from "path";

const dbPath = path.resolve(__dirname, "../../db/custom.db").replace(/\\/g, "/");
const databaseUrl = process.env.DATABASE_URL || `file:${dbPath}`;

const globalForPrisma = globalThis as unknown as { __txPrisma?: PrismaClient };

export const db =
  globalForPrisma.__txPrisma ??
  new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: process.env.PRISMA_LOG ? ["query", "error", "warn"] : ["error"],
  });

if (!globalForPrisma.__txPrisma) {
  globalForPrisma.__txPrisma = db;
}
