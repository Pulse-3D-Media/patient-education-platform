import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Test runner settings. Run the tests with: npm test
 *
 * Tests live next to the code they cover (lib/db/clinics.test.ts covers
 * lib/db/clinics.ts; app/pulse/actions.test.ts covers the dashboard's
 * actions). They hit a real database, the Neon "testing" branch, never
 * production: vitest.setup.ts points Prisma at it and refuses to run
 * otherwise.
 */
export default defineConfig({
  resolve: {
    alias: {
      // "@/lib/..." means the repo root, the same as in tsconfig.json.
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Next.js's font loader only works inside its own compiler; the tests get a stand-in (see vitest.fonts.ts).
      "next/font/google": fileURLToPath(new URL("./vitest.fonts.ts", import.meta.url)),
      // "server-only" refuses to load anywhere but inside Next.js's server build; the tests get an empty stand-in (see vitest.server-only.ts).
      "server-only": fileURLToPath(new URL("./vitest.server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "app/**/*.test.tsx", "components/**/*.test.ts", "components/**/*.test.tsx", "prisma/**/*.test.ts", "vitest.guard.test.ts", "instrumentation.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // One test file at a time. They share one database, so running files side
    // by side would only make failures harder to read.
    fileParallelism: false,
    // How long one test, or one beforeAll or afterAll, may take before it is
    // failed. Vitest's own limits (5 and 10 seconds) are too short here: almost
    // all of a database test's time is waiting on the remote testing branch, at
    // about 70ms a query, and the busiest tests make over 100 queries (one makes
    // nearly 600). On 2026-11-02, with the branch to itself, 44 of 1,841 tests
    // passed 5 seconds and the slowest took 28. A test that hits a limit keeps
    // running behind the next ones, and its cleanup can run too early, which
    // leaves rows behind that fail other tests. So a limit should only ever
    // catch something that has really hung.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
