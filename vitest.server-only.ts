/**
 * A stand-in for the "server-only" package, for the tests.
 *
 * The real package throws the moment it is loaded outside Next.js's server
 * build. That is its whole job: lib/db/client.ts imports it so that browser
 * code can never pull the database in. Vitest is not Next.js, so the tests
 * get this empty file instead (the alias is in vitest.config.mts).
 */
export {};
