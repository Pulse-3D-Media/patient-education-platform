import { checkScriptTarget, databaseKind, PRODUCTION_FLAG } from "../prisma/preflight";
import {
  CLEANUP_CLINIC_LIMIT,
  clinicUserIdsForCleanup,
  deleteClinicForCleanup,
  existingClinicIds,
  getClinicForCleanup,
  listClinicsForCleanup,
  type CleanupClinic,
} from "./db/demo-cleanup";
import { errorKind } from "./error-kind";
import { isTestClerkSecretKey, type DemoCleanupClerk } from "./clerk-demo-cleanup";
import { isTestSecretKey, type DemoCleanupStripe } from "./stripe";

/**
 * The demo clean-up: clears the clinics that sales demos leave behind on the
 * demo site, from all three places they live (our database, Clerk, Stripe),
 * and keeps the showroom clinic. Run by prisma/clear-demo-clinics.ts:
 *
 *   npm run db:clear-demo-clinics -- --keep <clinicId>            (a dry run: lists, deletes nothing)
 *   npm run db:clear-demo-clinics -- --keep <clinicId> --confirm  (deletes)
 *
 * THE SAFETY RULES, every one of them checked before anything is read:
 *
 * - Never production. The database is checked the way every operator script
 *   checks it (prisma/preflight.ts), and unlike the others there is NO
 *   --production override: given, the run is refused.
 * - Stripe's key must be a test key and Clerk's secret key a test-instance
 *   key. A live key of either refuses the run.
 * - A keep list is required (--keep, or DEMO_KEEP_CLINIC_IDS), and every id
 *   on it must be a clinic, so a typo stops the run instead of clearing the
 *   showroom.
 * - Clinics made in the last --hours hours (24 unless told) are kept, so a
 *   demo in progress is never wiped.
 * - A dry run unless --confirm is given.
 *
 * For each clinic it clears, in this order: Stripe first (cancel the test
 * subscription, delete the test customer), then Clerk (delete the
 * organization, then each of its people who now belong to no organization
 * and are not Pulse staff), then our rows in one transaction. If Stripe or
 * Clerk fails, that clinic stops there, its rows stay, and the run goes on
 * to the next and ends with a non-zero exit. Already-gone records count as
 * done, so running it again is safe and finishes the job.
 *
 * It prints clinic names, clinic ids and counts. Never a connection string,
 * a key, a link code or an email address.
 */

/** Hours a new clinic is kept for, unless --hours says otherwise. */
export const DEFAULT_KEEP_HOURS = 24;
/** The longest --hours accepted: a year. */
const MAX_KEEP_HOURS = 24 * 365;

export type CleanupStart =
  | { ok: true; confirm: boolean; keepClinicIds: string[]; keepHours: number; host: string }
  | { ok: false; reason: string };

/** "a, b,,c" into ["a", "b", "c"]. */
function idList(text: string | undefined): string[] {
  return (text ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * May the clean-up start, and with what? Pure: give it the environment and
 * the command-line arguments, it gives back the decision. The reason, when
 * refused, never contains a key or a connection string.
 */
export function checkCleanupStart(
  env: Record<string, string | undefined>,
  argv: string[],
): CleanupStart {
  const refuse = (why: string): CleanupStart => ({ ok: false, reason: `Refusing to run: ${why} Nothing was changed.` });

  if (argv.includes(PRODUCTION_FLAG)) {
    return refuse(`the demo clean-up never runs against production, so ${PRODUCTION_FLAG} is not accepted.`);
  }

  // The arguments.
  let confirm = false;
  let keepHours = DEFAULT_KEEP_HOURS;
  const keep = new Set(idList(env.DEMO_KEEP_CLINIC_IDS));
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [name, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    if (name === "--confirm" && inline === undefined) {
      confirm = true;
    } else if (name === "--keep" || name === "--hours") {
      const value = inline ?? argv[(i += 1)];
      if (value === undefined || value.startsWith("--")) return refuse(`${name} needs a value after it.`);
      if (name === "--keep") {
        for (const id of idList(value)) keep.add(id);
      } else {
        if (!/^\d+$/.test(value.trim())) return refuse(`--hours must be a whole number of hours, such as 24.`);
        keepHours = Number(value.trim());
        if (keepHours < 1 || keepHours > MAX_KEEP_HOURS) return refuse(`--hours must be between 1 and ${MAX_KEEP_HOURS}.`);
      }
    } else {
      return refuse(`"${arg.slice(0, 40)}" is not something this script understands. Use --keep <clinicId>, --hours <number> and --confirm.`);
    }
  }

  // The database: the operator scripts' own check, with no way to say "production".
  // (Its refusals for production, and for "cannot tell", suggest --production, which this script does not take, so those are said here instead.)
  const kind = databaseKind(env);
  if (kind === "production") return refuse("DATABASE_URL is the PRODUCTION database. The demo clean-up only runs on the demo site's database.");
  if (kind === "unknown" && env.DATABASE_URL?.trim()) {
    return refuse("this script cannot tell whether DATABASE_URL is production, so it treats it as production. Set PRODUCTION_DATABASE_HOST (the production database's host name, no password) in .env.demo.");
  }
  const target = checkScriptTarget(env, []);
  if (!target.ok) return { ok: false, reason: target.reason };
  if (target.production) return refuse(`${target.host} is the production database.`);

  // Stripe and Clerk: test keys only.
  if (!isTestSecretKey(env.STRIPE_SECRET_KEY)) {
    return refuse("STRIPE_SECRET_KEY is missing or is not a Stripe test key (sk_test_ or rk_test_). The clean-up only runs on Stripe's test mode.");
  }
  if (!isTestClerkSecretKey(env.CLERK_SECRET_KEY)) {
    return refuse("CLERK_SECRET_KEY is missing or is not a key for a Clerk test (development) instance (sk_test_). The clean-up never touches the live sign-in.");
  }

  if (keep.size === 0) {
    return refuse("no clinic to keep was named. Give the showroom clinic's id with --keep <clinicId> (several separated by commas), or set DEMO_KEEP_CLINIC_IDS.");
  }

  return { ok: true, confirm, keepClinicIds: [...keep], keepHours, host: target.host };
}

export type CleanupOptions = {
  confirm: boolean;
  keepClinicIds: string[];
  keepHours: number;
  stripe: DemoCleanupStripe;
  clerk: DemoCleanupClerk;
  /** Now, as the run sees it. A parameter so the tests can set it. */
  now: Date;
  /** Where each line goes. console.log in the script. */
  log: (line: string) => void;
};

export type CleanupResult = {
  /** 0 when everything asked for was done, 1 when anything failed or was refused. */
  exitCode: number;
  cleared: string[];
  failed: string[];
  kept: string[];
};

function describeClinic(clinic: CleanupClinic): string {
  return `"${clinic.name}" (${clinic.id}), made ${clinic.createdAt.toISOString().slice(0, 10)}`;
}

function counts(clinic: CleanupClinic): string {
  return `${clinic.seats} seats held, ${clinic.seatInvitations} open invitations, ${clinic.links} patient links, ${clinic.qrCodes} printed codes, ${clinic.notes} log entries`;
}

/** Run the clean-up, as a dry run or for real. Never throws for a single clinic's failure; it reports it and goes on. */
export async function runDemoCleanup(options: CleanupOptions): Promise<CleanupResult> {
  const { log } = options;
  const result: CleanupResult = { exitCode: 0, cleared: [], failed: [], kept: [] };
  const createdBefore = new Date(options.now.getTime() - options.keepHours * 60 * 60 * 1000);

  // Every name on the keep list must be a clinic, or the run stops before anything else.
  const existing = await existingClinicIds(options.keepClinicIds);
  const missing = options.keepClinicIds.filter((id) => !existing.has(id));
  if (missing.length > 0) {
    log(`Refusing to run: no clinic has the id ${missing.map((id) => `"${id.slice(0, 40)}"`).join(", ")}, which is on the keep list. Check the id. Nothing was changed.`);
    return { ...result, exitCode: 1 };
  }

  const { clinics, total } = await listClinicsForCleanup();
  const toClear: CleanupClinic[] = [];
  log(options.confirm ? "DELETING demo clinics (--confirm was given)." : "DRY RUN: nothing will be deleted. Add --confirm to delete what is listed under \"Would clear\".");
  log("");
  log("Keeping:");
  for (const clinic of clinics) {
    if (options.keepClinicIds.includes(clinic.id)) {
      log(`  ${describeClinic(clinic)}: on the keep list`);
      result.kept.push(clinic.id);
    } else if (clinic.createdAt >= createdBefore) {
      log(`  ${describeClinic(clinic)}: made in the last ${options.keepHours} hours`);
      result.kept.push(clinic.id);
    } else {
      toClear.push(clinic);
    }
  }
  log("");

  if (toClear.length === 0) {
    log("Nothing to clear.");
  } else if (!options.confirm) {
    log("Would clear:");
    for (const clinic of toClear) {
      log(`  ${describeClinic(clinic)}`);
      log(`    ${counts(clinic)}`);
      log(`    Stripe: ${await stripeDescription(options.stripe, clinic)}`);
      log(`    Clerk:  ${await clerkDescription(options.clerk, clinic)}`);
    }
  } else {
    for (const clinic of toClear) {
      const ok = await clearOneClinic(options, clinic, createdBefore);
      (ok ? result.cleared : result.failed).push(clinic.id);
    }
  }

  if (total > clinics.length) {
    log("");
    log(`Only the oldest ${CLEANUP_CLINIC_LIMIT} of ${total} clinics were looked at. Run it again for the rest.`);
  }

  log("");
  if (options.confirm) {
    log(`Done: ${result.cleared.length} cleared, ${result.failed.length} could not be cleared, ${result.kept.length} kept.`);
  } else {
    log(`Dry run done: ${toClear.length} would be cleared, ${result.kept.length} kept. Nothing was changed.`);
  }
  if (result.failed.length > 0) {
    log("The ones that could not be cleared still have their rows here. Run the same command again to finish them.");
    result.exitCode = 1;
  }
  return result;
}

async function stripeDescription(stripe: DemoCleanupStripe, clinic: CleanupClinic): Promise<string> {
  if (!clinic.stripeCustomerId) return "no customer recorded";
  try {
    const state = await stripe.customerState(clinic.stripeCustomerId);
    const sub = clinic.stripeSubscriptionId ? ", with a subscription recorded" : "";
    return state === "present" ? `test customer found${sub}` : "customer recorded, already gone from Stripe";
  } catch (error) {
    return `could not check (${errorKind(error)})`;
  }
}

async function clerkDescription(clerk: DemoCleanupClerk, clinic: CleanupClinic): Promise<string> {
  if (!clinic.clerkOrgId) return "no organization recorded";
  try {
    const members = await clerk.organizationMembers(clinic.clerkOrgId);
    return members === null ? "organization recorded, already gone from Clerk" : `organization found, ${members.length} people in it`;
  } catch (error) {
    return `could not check (${errorKind(error)})`;
  }
}

/** Clear one clinic: Stripe, then Clerk, then our rows. True when it is gone from all three. */
async function clearOneClinic(options: CleanupOptions, listed: CleanupClinic, createdBefore: Date): Promise<boolean> {
  const { log } = options;
  log(`Clearing ${describeClinic(listed)}`);

  // Read again: it may have changed (or gone) since the list was made.
  const clinic = await getClinicForCleanup(listed.id);
  if (!clinic) {
    log("  already gone from our database. Nothing to do.");
    return true;
  }

  // 1. Stripe.
  try {
    if (clinic.stripeSubscriptionId) await options.stripe.cancelSubscription(clinic.stripeSubscriptionId);
    if (clinic.stripeCustomerId) await options.stripe.deleteCustomer(clinic.stripeCustomerId);
    log(clinic.stripeCustomerId || clinic.stripeSubscriptionId ? "  Stripe: test subscription cancelled and customer deleted (or already gone)." : "  Stripe: nothing recorded.");
  } catch (error) {
    log(`  STOPPED: Stripe could not be updated (${errorKind(error)}). This clinic was left as it was; Clerk and our rows were not touched.`);
    return false;
  }

  // 2. Clerk: the organization, then the people it leaves belonging to nothing.
  let removedUsers = 0;
  let keptStaff = 0;
  let keptElsewhere = 0;
  try {
    const members = clinic.clerkOrgId ? await options.clerk.organizationMembers(clinic.clerkOrgId) : null;
    // Our own rows remember people too, so a second run after the organization is gone still finds them.
    const candidates = new Set([...(members ?? []), ...(await clinicUserIdsForCleanup(clinic.id))]);
    if (clinic.clerkOrgId && members !== null) await options.clerk.deleteOrganization(clinic.clerkOrgId);

    for (const userId of candidates) {
      const state = await options.clerk.userState(userId);
      if (!state.exists) continue;
      if (state.pulseStaff) {
        keptStaff += 1;
      } else if (state.organizations > 0) {
        keptElsewhere += 1;
      } else {
        await options.clerk.deleteUser(userId);
        removedUsers += 1;
      }
    }
    const org = !clinic.clerkOrgId ? "no organization recorded" : members === null ? "organization already gone" : "organization deleted";
    log(`  Clerk: ${org}; ${removedUsers} people deleted who belonged to no other organization; ${keptStaff} Pulse staff kept; ${keptElsewhere} kept because they belong to another organization.`);
  } catch (error) {
    log(`  STOPPED: Clerk could not be updated (${errorKind(error)}). Stripe is done; our rows were not touched. Run it again to finish.`);
    return false;
  }

  // 3. Our rows, in one transaction.
  try {
    const outcome = await deleteClinicForCleanup(clinic.id, { keepClinicIds: options.keepClinicIds, createdBefore });
    if (outcome.outcome === "refused") {
      log(`  STOPPED: our rows were not deleted because ${outcome.reason}.`);
      return false;
    }
    if (outcome.outcome === "gone") {
      log("  Database: already gone.");
    } else {
      const parts = Object.entries(outcome.rows).filter(([, count]) => count > 0).map(([table, count]) => `${count} ${table}`);
      log(`  Database: deleted ${parts.join(", ")}.`);
    }
    return true;
  } catch (error) {
    log(`  STOPPED: our rows could not be deleted (${errorKind(error)}). Stripe and Clerk are done; nothing in our database changed. Run it again to finish.`);
    return false;
  }
}
