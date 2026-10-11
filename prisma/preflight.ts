/**
 * The check every operator script in prisma/ runs before it touches the
 * database: which database is this, and is it production?
 *
 * Why: the scripts load .env (package.json passes --env-file=.env), and the
 * main checkout's .env is production. Without a check, running one of them
 * "to try it" changes real clinics. So a script refuses to run against
 * production unless the person running it says so, in as many words, with
 * --production on the command line:
 *
 *   npm run db:set-status -- <clinicId> PAUSED "reason" --production
 *
 * How production is recognised: .env names it with PRODUCTION_DATABASE_HOST,
 * the host name of the production database (no password, no user, just the
 * part after the "@", for instance ep-something.us-east-2.aws.neon.tech).
 * The target is DATABASE_URL, the connection the scripts actually use. The
 * two are compared the way the test guard compares them (endpointOf in
 * vitest.guard.ts), so Neon's pooled and direct addresses of one database
 * count as the same database.
 *
 * It fails closed. Whenever the answer is not a clear "this is not
 * production", the target is treated as production:
 *
 * - PRODUCTION_DATABASE_HOST is not set, or cannot be read: there is nothing
 *   to compare against, so the script needs --production.
 * - DATABASE_URL is not set or cannot be read: refused outright, flag or not.
 *
 * And --production is a claim the check holds you to: given for a database
 * that is clearly not production, the script refuses, because either the
 * flag or PRODUCTION_DATABASE_HOST is wrong.
 *
 * It never prints a connection string: only the host name, which carries no
 * password.
 *
 * DIRECT_URL is not looked at: none of these scripts uses it (it is for
 * migrations, which these scripts never run).
 */
import { endpointOf } from "../vitest.guard";

/** The command-line word that says "yes, this is production, and I mean it". */
export const PRODUCTION_FLAG = "--production";

export type TargetCheck =
  | {
      ok: true;
      /** The host the script will write to, safe to print. */
      host: string;
      /** True when the script is about to run against production. */
      production: boolean;
      /** The command-line arguments with --production taken out, for the script to read. */
      args: string[];
    }
  | { ok: false; reason: string };

/**
 * The production host as a comparable endpoint. Accepts a bare host name or,
 * in case someone pastes one, a whole connection string. Null when empty or
 * unreadable.
 */
function productionEndpoint(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  return endpointOf(text.includes("://") ? text : `postgresql://${text}`);
}

/**
 * May this script run? Pure: give it the environment and the arguments, it
 * gives back the decision. Never returns a connection string.
 */
export function checkScriptTarget(env: { DATABASE_URL?: string; PRODUCTION_DATABASE_HOST?: string }, argv: string[]): TargetCheck {
  const saidProduction = argv.includes(PRODUCTION_FLAG);
  const args = argv.filter((arg) => arg !== PRODUCTION_FLAG);

  if (!env.DATABASE_URL?.trim()) {
    return { ok: false, reason: "Refusing to run: DATABASE_URL is not set, so there is no database to run against." };
  }
  const target = endpointOf(env.DATABASE_URL);
  if (!target) {
    return { ok: false, reason: "Refusing to run: DATABASE_URL is set but cannot be read as a connection string." };
  }

  const production = productionEndpoint(env.PRODUCTION_DATABASE_HOST);

  // Nothing to compare against: treat it as production.
  if (!production) {
    if (saidProduction) return { ok: true, host: target, production: true, args };
    const why = env.PRODUCTION_DATABASE_HOST?.trim()
      ? "PRODUCTION_DATABASE_HOST is set but cannot be read as a host name"
      : "PRODUCTION_DATABASE_HOST is not set";
    return {
      ok: false,
      reason: `Refusing to run against ${target}: ${why}, so this script cannot tell whether it is production and treats it as production. If it is, add ${PRODUCTION_FLAG} to the command. Nothing was changed.`,
    };
  }

  if (target === production) {
    if (saidProduction) return { ok: true, host: target, production: true, args };
    return {
      ok: false,
      reason: `Refusing to run: ${target} is the PRODUCTION database. If you mean to change production, add ${PRODUCTION_FLAG} to the command. Nothing was changed.`,
    };
  }

  if (saidProduction) {
    return {
      ok: false,
      reason: `Refusing to run: ${PRODUCTION_FLAG} was given, but ${target} is not the production database named by PRODUCTION_DATABASE_HOST. Check which database you meant. Nothing was changed.`,
    };
  }
  return { ok: true, host: target, production: false, args };
}

/**
 * What each script calls first, before any query. Prints which database it
 * is about to use, or prints why not and stops the script. Returns the
 * arguments with --production taken out.
 */
export function preflight(): string[] {
  const { DATABASE_URL, PRODUCTION_DATABASE_HOST } = process.env;
  const result = checkScriptTarget({ DATABASE_URL, PRODUCTION_DATABASE_HOST }, process.argv.slice(2));
  if (!result.ok) {
    console.error(result.reason);
    process.exit(1);
  }
  console.log(`Database: ${result.host}${result.production ? " (PRODUCTION)" : " (not production)"}`);
  return result.args;
}
