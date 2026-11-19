/**
 * Run one command against the PRODUCTION database:
 *
 *   npm run on-production -- npx prisma migrate deploy
 *   npm run on-production -- npm run db:set-status -- <clinicId> PAUSED "reason" --production
 *
 * It reads production's two connection strings from .env.release, checks
 * them (planRelease() in release-plan.ts, which has the reasons and its own
 * tests), says which database it is about to use, and runs the command with
 * those two strings set. A value already set this way wins over .env, both
 * for Prisma's own commands and for the db:* scripts, so the command reaches
 * production instead of the testing branch .env points at.
 *
 * Production is touched only on Evan's explicit word (rule 3). This script
 * does not decide that; it only makes "production" something a command has
 * to ask for by name.
 *
 * It makes no query of its own and never prints a connection string.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { planRelease } from "./release-plan";

function readEnvFile(path: string): Record<string, string | undefined> | null {
  if (!existsSync(path)) return null;
  return parseEnv(readFileSync(path, "utf8")) as Record<string, string | undefined>;
}

const command = process.argv.slice(2);
const appEnv = readEnvFile(".env") ?? {};
const plan = planRelease(readEnvFile(".env.release"), appEnv.PRODUCTION_DATABASE_HOST, command);

if (!plan.ok) {
  console.error(plan.reason);
  process.exit(1);
}

// One line for the shell: a word with a space or a quote in it goes back in quotes.
const line = command.map((word) => (/[\s"&|<>^]/.test(word) ? `"${word.replace(/"/g, '\\"')}"` : word)).join(" ");

console.log(`PRODUCTION database: ${plan.host}`);
console.log(`Running: ${line}`);

const result = spawnSync(line, {
  shell: true,
  stdio: "inherit",
  env: { ...process.env, ...plan.env, PRODUCTION_DATABASE_HOST: appEnv.PRODUCTION_DATABASE_HOST },
});

process.exit(result.status ?? 1);
