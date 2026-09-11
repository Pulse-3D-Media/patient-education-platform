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
  // "@/lib/..." means the repo root, the same as in tsconfig.json.
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // One test file at a time. They share one database, so running files side
    // by side would only make failures harder to read.
    fileParallelism: false,
  },
});
