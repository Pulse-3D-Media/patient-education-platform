import { prisma } from "./client";

/**
 * Can the app reach its database right now? One trivial query, SELECT 1,
 * which any healthy database answers at once. It reads no table and writes
 * nothing. Throws when the database cannot be reached; the health check
 * route (app/api/health) turns that into "not ok" and puts the kind of
 * failure in the server log.
 */
export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
