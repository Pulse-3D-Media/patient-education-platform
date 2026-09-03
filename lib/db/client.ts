import { PrismaClient } from "@prisma/client";

/**
 * The one Prisma client for the whole app.
 *
 * Every query function in lib/db imports this. Nothing outside lib/db should.
 * (Rule 1 in CLAUDE.md: all database access goes through lib/db, on the server.)
 *
 * Why the globalThis dance: in development Next.js reloads code on every save,
 * and each reload would otherwise open a brand-new database connection. Parking
 * the client on globalThis means one connection survives across reloads.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
