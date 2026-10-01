import "server-only";
import { PrismaClient } from "@prisma/client";

/**
 * The one Prisma client for the whole app.
 *
 * Every query function in lib/db imports this. Nothing outside lib/db should.
 * (Rule 1 in CLAUDE.md: all database access goes through lib/db, on the server.)
 *
 * The first line, import "server-only", is the guard that enforces "on the
 * server": if a file that runs in the browser ever imports anything in lib/db,
 * even by accident through another file, the build fails instead of quietly
 * shipping database code to the browser. The tests swap the package for an
 * empty file (vitest.config.mts), and the scripts in prisma/ run with
 * --conditions=react-server (package.json), which tells it they are server code.
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
