import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./db/client";
import { deleteClinicForCleanup } from "./db/demo-cleanup";
import { checkCleanupStart, runDemoCleanup, type CleanupOptions } from "./demo-cleanup";
import type { CleanupUserState, DemoCleanupClerk } from "./clerk-demo-cleanup";
import type { DemoCleanupStripe } from "./stripe";

/**
 * The demo clean-up, against the real test database, with stand-ins for
 * Stripe and Clerk (nothing here reaches either service). Every id, key and
 * address is made up.
 *
 * The test database is shared with every other test file, and may hold
 * clinics those left behind. So the clinics made here are dated in the year
 * 2000 and the run is told it is June 2000: every other clinic in the
 * database counts as "made too recently" and is kept, and only these can be
 * cleared.
 */

const NOW = new Date("2000-06-01T00:00:00Z");
const OLD = new Date("2000-01-01T00:00:00Z");
const TOO_NEW = new Date("2000-05-31T12:00:00Z"); // 12 hours before NOW

const tag = randomBytes(6).toString("hex");
const madeClinicIds: string[] = [];
const madeVideoIds: string[] = [];
const madePricingIds: string[] = [];
const madeCategories: string[] = [];

// ---------------------------------------------------------------------------
// Stand-ins
// ---------------------------------------------------------------------------

const DEMO_ACCOUNT = "acct_fakedemo";

/** Stripe's customers and subscriptions, each with the clinic id in its metadata (null for none). */
class FakeStripe implements DemoCleanupStripe {
  account = DEMO_ACCOUNT;
  /** When set, asking for the account fails, the way a Stripe outage would. */
  accountFails = false;
  customers = new Map<string, string | null>();
  subscriptions = new Map<string, string | null>();
  /** Every call that could change something, in order. Reads are not listed. */
  calls: string[] = [];
  /** Customer ids whose deletion fails, the way a Stripe outage would. */
  failFor = new Set<string>();

  async accountId() {
    if (this.accountFails) throw Object.assign(new Error("fake outage"), { type: "StripeConnectionError" });
    return this.account;
  }
  async customerOwner(id: string) {
    return this.customers.has(id) ? { gone: false as const, clinicId: this.customers.get(id) ?? null } : { gone: true as const };
  }
  async subscriptionOwner(id: string) {
    return this.subscriptions.has(id) ? { gone: false as const, clinicId: this.subscriptions.get(id) ?? null } : { gone: true as const };
  }
  async cancelSubscription(id: string, clinicId: string) {
    this.calls.push(`cancel ${id}`);
    if (this.subscriptions.has(id) && this.subscriptions.get(id) !== clinicId) throw new Error("fake: metadata mismatch");
    this.subscriptions.delete(id);
  }
  async deleteCustomer(id: string, clinicId: string) {
    this.calls.push(`delete ${id}`);
    if (this.failFor.has(id)) throw Object.assign(new Error("fake outage"), { type: "StripeConnectionError" });
    if (this.customers.has(id) && this.customers.get(id) !== clinicId) throw new Error("fake: metadata mismatch");
    this.customers.delete(id);
  }
}

class FakeClerk implements DemoCleanupClerk {
  orgs = new Map<string, Set<string>>();
  users = new Map<string, { pulseStaff: boolean }>();
  calls: string[] = [];

  addOrg(orgId: string, userIds: string[]) {
    this.orgs.set(orgId, new Set(userIds));
    for (const id of userIds) if (!this.users.has(id)) this.users.set(id, { pulseStaff: false });
  }
  async organizationMembers(orgId: string) {
    const org = this.orgs.get(orgId);
    return org ? [...org] : null;
  }
  async deleteOrganization(orgId: string) {
    this.calls.push(`delete org ${orgId}`);
    this.orgs.delete(orgId);
  }
  /** User ids whose organizations come back in a shape the real code refuses (it throws). */
  unreadable = new Set<string>();
  async userState(userId: string): Promise<CleanupUserState> {
    if (this.unreadable.has(userId)) throw new Error("fake: the answer was not in the expected shape");
    const user = this.users.get(userId);
    if (!user) return { exists: false };
    const organizations = [...this.orgs.values()].filter((members) => members.has(userId)).length;
    return { exists: true, pulseStaff: user.pulseStaff, organizations };
  }
  async deleteUser(userId: string) {
    this.calls.push(`delete user ${userId}`);
    this.users.delete(userId);
  }
}

let stripe: FakeStripe;
let clerk: FakeClerk;
let lines: string[];

beforeEach(() => {
  stripe = new FakeStripe();
  clerk = new FakeClerk();
  lines = [];
});

function options(overrides: Partial<CleanupOptions> = {}): CleanupOptions {
  return { confirm: false, keepClinicIds: [], keepHours: 24, stripeAccountId: DEMO_ACCOUNT, stripe, clerk, now: NOW, log: (line) => lines.push(line), ...overrides };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

async function sharedVideo() {
  const category = `VTDEMO${tag.toUpperCase()}`;
  if (!madeCategories.includes(category)) {
    await prisma.categoryConfig.create({ data: { category } });
    madeCategories.push(category);
  }
  const video = await prisma.video.create({ data: { title: `Vitest demo video ${tag}`, category } });
  madeVideoIds.push(video.id);
  return video.id;
}

async function sharedPricingVersion() {
  const version = await prisma.pricingVersion.create({ data: { config: {}, note: "vitest demo clean-up", createdBy: "user_fake", createdByName: "Vitest" } });
  madePricingIds.push(version.id);
  return version.id;
}

/** A clinic with a row in every table that belongs to a clinic, and its organization and customer in the stand-ins. */
async function makeFullClinic(label: string, createdAt: Date, people: string[] = []) {
  const id = `${label}`;
  const orgId = `org_fake_${label}`;
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest demo ${label}`, clerkOrgId: orgId, createdAt, ownerClerkUserId: people[0] ?? null },
  });
  madeClinicIds.push(clinic.id);
  const videoId = await sharedVideo();
  const pricingVersionId = await sharedPricingVersion();
  const customerId = `cus_fake_${id}`;
  const subscriptionId = `sub_fake_${id}`;

  const qr = await prisma.qrCode.create({ data: { code: randomBytes(12).toString("hex"), clinicId: clinic.id, videoId, senderUserId: people[0] ?? "user_fake_none" } });
  await prisma.share.create({ data: { code: randomBytes(8).toString("hex"), clinicId: clinic.id, videoId, expiresAt: new Date("2000-12-31"), qrCodeId: qr.id } });
  await prisma.share.create({ data: { code: randomBytes(8).toString("hex"), clinicId: clinic.id, videoId, expiresAt: new Date("2000-12-31") } });
  const plan = await prisma.billingPlan.create({
    data: { clinicId: clinic.id, pricingVersionId, categories: [], entitledCategories: [], surgeonSeats: 1, interval: "MONTH", perSeatCents: 100, totalCents: 100, acceptedById: "user_fake", acceptedByName: "Vitest" },
  });
  await prisma.clinicBilling.create({ data: { clinicId: clinic.id, stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, status: "ACTIVE", currentPlanId: plan.id } });
  await prisma.billingEvent.create({ data: { stripeEventId: `evt_fake_${randomBytes(8).toString("hex")}`, type: "invoice.paid", clinicId: clinic.id } });
  await prisma.clinicNote.create({ data: { clinicId: clinic.id, body: "Vitest demo note", authorName: "Vitest" } });
  await prisma.seatInvitation.create({ data: { clinicId: clinic.id } });
  for (const userId of people) {
    await prisma.seatAllocation.create({ data: { clinicId: clinic.id, clerkUserId: userId } });
    await prisma.personalVideo.create({ data: { clinicId: clinic.id, clerkUserId: userId, videoId, playCount: 1 } });
  }

  stripe.customers.set(customerId, clinic.id);
  stripe.subscriptions.set(subscriptionId, clinic.id);
  clerk.addOrg(orgId, people);
  return { clinicId: clinic.id, orgId, customerId, subscriptionId };
}

/** How many rows belong to this clinic, table by table. */
async function rowsOf(clinicId: string) {
  const where = { clinicId };
  return {
    Clinic: await prisma.clinic.count({ where: { id: clinicId } }),
    Share: await prisma.share.count({ where }),
    QrCode: await prisma.qrCode.count({ where }),
    ClinicBilling: await prisma.clinicBilling.count({ where }),
    BillingPlan: await prisma.billingPlan.count({ where }),
    BillingEvent: await prisma.billingEvent.count({ where }),
    PersonalVideo: await prisma.personalVideo.count({ where }),
    ClinicNote: await prisma.clinicNote.count({ where }),
    SeatAllocation: await prisma.seatAllocation.count({ where }),
    SeatInvitation: await prisma.seatInvitation.count({ where }),
  };
}

/** The shared tables, which the clean-up never touches. */
async function sharedCounts() {
  return {
    Video: await prisma.video.count(),
    CategoryConfig: await prisma.categoryConfig.count(),
    PricingVersion: await prisma.pricingVersion.count(),
    AppSettings: await prisma.appSettings.count(),
  };
}

const ALL_GONE = { Clinic: 0, Share: 0, QrCode: 0, ClinicBilling: 0, BillingPlan: 0, BillingEvent: 0, PersonalVideo: 0, ClinicNote: 0, SeatAllocation: 0, SeatInvitation: 0 };

let counter = 0;
const label = (what: string) => `vtdemo_${tag}_${what}_${(counter += 1)}`;

/**
 * After every test, whatever it left (the kept clinics, a failed clean-up on
 * purpose), in the order the keys allow, so the next test starts with none of
 * this file's clinics in the database.
 */
async function removeWhatWasMade() {
  const where = { clinicId: { in: madeClinicIds } };
  await prisma.share.deleteMany({ where });
  await prisma.qrCode.deleteMany({ where });
  await prisma.clinicBilling.deleteMany({ where });
  await prisma.billingPlan.deleteMany({ where });
  await prisma.billingEvent.deleteMany({ where });
  await prisma.clinic.deleteMany({ where: { id: { in: madeClinicIds } } });
  await prisma.personalVideo.deleteMany({ where: { videoId: { in: madeVideoIds } } });
  await prisma.video.deleteMany({ where: { id: { in: madeVideoIds } } });
  await prisma.categoryConfig.deleteMany({ where: { category: { in: madeCategories } } });
  await prisma.pricingVersion.deleteMany({ where: { id: { in: madePricingIds } } });
  for (const list of [madeClinicIds, madeVideoIds, madePricingIds, madeCategories]) list.length = 0;
}

afterEach(removeWhatWasMade);

afterAll(async () => {
  await removeWhatWasMade();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Refusals before anything starts (pure)
// ---------------------------------------------------------------------------

describe("checkCleanupStart", () => {
  const prodHost = "ep-prod-example-123.us-east-2.aws.neon.tech";
  const demoEnv = {
    DATABASE_URL: "postgresql://user:secret@ep-tst-example-456-pooler.us-east-2.aws.neon.tech/neondb",
    PRODUCTION_DATABASE_HOST: prodHost,
    STRIPE_SECRET_KEY: "sk_test_madeup",
    CLERK_SECRET_KEY: "sk_test_madeupclerk",
    DEMO_DATABASE_HOST: "ep-tst-example-456.us-east-2.aws.neon.tech",
    DEMO_STRIPE_ACCOUNT_ID: "acct_madeupdemo",
  };

  it("starts on the demo database with test keys and a keep list, as a dry run unless --confirm", () => {
    expect(checkCleanupStart(demoEnv, ["--keep", "clinic_1"])).toMatchObject({ ok: true, confirm: false, keepClinicIds: ["clinic_1"], keepHours: 24 });
    expect(checkCleanupStart(demoEnv, ["--keep=clinic_1,clinic_2", "--hours", "48", "--confirm"])).toMatchObject({
      ok: true,
      confirm: true,
      keepClinicIds: ["clinic_1", "clinic_2"],
      keepHours: 48,
    });
    expect(checkCleanupStart({ ...demoEnv, DEMO_KEEP_CLINIC_IDS: " clinic_3 , " }, [])).toMatchObject({ ok: true, keepClinicIds: ["clinic_3"] });
  });

  it("refuses production, pooled or direct, and has no --production override", () => {
    for (const url of [
      "postgresql://user:secret@ep-prod-example-123-pooler.us-east-2.aws.neon.tech/neondb",
      "postgresql://user:secret@ep-prod-example-123.us-east-2.aws.neon.tech/neondb",
    ]) {
      const refused = checkCleanupStart({ ...demoEnv, DATABASE_URL: url }, ["--keep", "c"]);
      expect(refused.ok).toBe(false);
      // It never suggests the override the other scripts take.
      if (!refused.ok) expect(refused.reason).not.toContain("add --production");
      expect(checkCleanupStart({ ...demoEnv, DATABASE_URL: url }, ["--keep", "c", "--production"]).ok).toBe(false);
    }
    expect(checkCleanupStart(demoEnv, ["--keep", "c", "--production"]).ok).toBe(false);
  });

  it("refuses when it cannot tell the database is not production (fails closed)", () => {
    const unknown = checkCleanupStart({ ...demoEnv, PRODUCTION_DATABASE_HOST: "" }, ["--keep", "c"]);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).not.toContain("add --production");
    expect(checkCleanupStart({ ...demoEnv, DATABASE_URL: "" }, ["--keep", "c"]).ok).toBe(false);
  });

  it("refuses a live or missing Stripe key", () => {
    for (const key of ["sk_live_madeup", "rk_live_madeup", "", undefined]) {
      const result = checkCleanupStart({ ...demoEnv, STRIPE_SECRET_KEY: key }, ["--keep", "c"]);
      expect(result.ok, String(key)).toBe(false);
    }
  });

  it("refuses a live or missing Clerk key", () => {
    for (const key of ["sk_live_madeupclerk", "pk_test_madeup", "", undefined]) {
      const result = checkCleanupStart({ ...demoEnv, CLERK_SECRET_KEY: key }, ["--keep", "c"]);
      expect(result.ok, String(key)).toBe(false);
    }
  });

  it("refuses without DEMO_DATABASE_HOST, or when DATABASE_URL is not that database, and never prints either", () => {
    expect(checkCleanupStart({ ...demoEnv, DEMO_DATABASE_HOST: "" }, ["--keep", "c"]).ok).toBe(false);
    expect(checkCleanupStart({ ...demoEnv, DEMO_DATABASE_HOST: undefined }, ["--keep", "c"]).ok).toBe(false);
    // A wrong PRODUCTION_DATABASE_HOST makes production look safe to the deny check; the allow check still refuses it.
    const prodUrl = "postgresql://user:secret@ep-prod-example-123-pooler.us-east-2.aws.neon.tech/neondb";
    const wrongDeny = checkCleanupStart({ ...demoEnv, DATABASE_URL: prodUrl, PRODUCTION_DATABASE_HOST: "ep-wrong-000.us-east-2.aws.neon.tech" }, ["--keep", "c"]);
    expect(wrongDeny.ok).toBe(false);
    if (!wrongDeny.ok) {
      expect(wrongDeny.reason).toContain("DEMO_DATABASE_HOST");
      expect(wrongDeny.reason).not.toContain("ep-");
    }
    // Pooled or direct, written with a port or capitals: the same database.
    for (const host of ["ep-tst-example-456-pooler.us-east-2.aws.neon.tech", "EP-TST-EXAMPLE-456.us-east-2.aws.neon.tech:5432"]) {
      expect(checkCleanupStart({ ...demoEnv, DEMO_DATABASE_HOST: host }, ["--keep", "c"]).ok, host).toBe(true);
    }
  });

  it("refuses without a Stripe account id that looks like one", () => {
    for (const value of [undefined, "", "acct_", "sk_test_madeup", "acct_has space"]) {
      expect(checkCleanupStart({ ...demoEnv, DEMO_STRIPE_ACCOUNT_ID: value }, ["--keep", "c"]).ok, String(value)).toBe(false);
    }
    expect(checkCleanupStart(demoEnv, ["--keep", "c"])).toMatchObject({ ok: true, stripeAccountId: "acct_madeupdemo" });
  });

  it("refuses without a keep list", () => {
    const result = checkCleanupStart(demoEnv, ["--confirm"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("--keep");
    expect(checkCleanupStart({ ...demoEnv, DEMO_KEEP_CLINIC_IDS: " , " }, []).ok).toBe(false);
  });

  it("refuses arguments it does not understand, and bad hours", () => {
    for (const argv of [["--keep", "c", "--force"], ["--keep"], ["--keep", "c", "--hours", "a day"], ["--keep", "c", "--hours", "0"], ["--keep", "c", "--confirm=yes"]]) {
      expect(checkCleanupStart(demoEnv, argv).ok, argv.join(" ")).toBe(false);
    }
  });

  it("never prints a key or a password", () => {
    const refusals = [
      checkCleanupStart({ ...demoEnv, STRIPE_SECRET_KEY: "sk_live_madeup" }, ["--keep", "c"]),
      checkCleanupStart({ ...demoEnv, CLERK_SECRET_KEY: "sk_live_madeupclerk" }, ["--keep", "c"]),
      checkCleanupStart({ ...demoEnv, DATABASE_URL: "postgresql://user:secret@ep-prod-example-123.us-east-2.aws.neon.tech/neondb" }, ["--keep", "c"]),
    ];
    for (const result of refusals) {
      const text = result.ok ? "" : result.reason;
      expect(text).not.toContain("madeup");
      expect(text).not.toContain("secret");
      expect(text).not.toContain("postgresql://");
    }
  });

  it("the script itself refuses --production before the database check could accept it", () => {
    const source = readFileSync("prisma/clear-demo-clinics.ts", "utf8");
    expect(source.indexOf("process.argv.includes(PRODUCTION_FLAG)")).toBeGreaterThan(-1);
    expect(source.indexOf("process.argv.includes(PRODUCTION_FLAG)")).toBeLessThan(source.indexOf("preflight()"));
    expect(readFileSync("package.json", "utf8")).toContain("--env-file=.env.demo prisma/clear-demo-clinics.ts");
  });
});

// ---------------------------------------------------------------------------
// The run, against the test database
// ---------------------------------------------------------------------------

describe("runDemoCleanup", () => {
  it("a dry run lists what it would clear and deletes nothing anywhere", async () => {
    const showroom = await makeFullClinic(label("showroom"), OLD);
    const demo = await makeFullClinic(label("demo"), OLD, [`user_fake_${tag}_d1`]);
    const before = await rowsOf(demo.clinicId);

    const result = await runDemoCleanup(options({ keepClinicIds: [showroom.clinicId] }));

    expect(result.exitCode).toBe(0);
    expect(await rowsOf(demo.clinicId)).toEqual(before);
    expect(stripe.calls).toEqual([]);
    expect(clerk.calls).toEqual([]);
    const text = lines.join("\n");
    expect(text).toContain("DRY RUN");
    expect(text).toContain(demo.clinicId);
    expect(text).toContain("test customer found");
    expect(text).toContain("organization found, 1 people in it");
    // Names and ids only: no customer id, no Clerk user id.
    expect(text).not.toContain(demo.customerId);
    expect(text).not.toContain("user_fake");
  });

  it("--confirm clears a demo clinic from all three places, and keeps the showroom, a too-new clinic and every shared table", async () => {
    const userA = `user_fake_${tag}_a`;
    const showroom = await makeFullClinic(label("showroom"), OLD, [`user_fake_${tag}_show`]);
    const fresh = await makeFullClinic(label("fresh"), TOO_NEW);
    const demo = await makeFullClinic(label("demo"), OLD, [userA]);
    const showroomBefore = await rowsOf(showroom.clinicId);
    const freshBefore = await rowsOf(fresh.clinicId);
    const shared = await sharedCounts();

    const result = await runDemoCleanup(options({ confirm: true, keepClinicIds: [showroom.clinicId] }));

    expect(result.exitCode).toBe(0);
    expect(result.cleared).toEqual([demo.clinicId]);
    expect(await rowsOf(demo.clinicId)).toEqual(ALL_GONE);
    expect(await rowsOf(showroom.clinicId)).toEqual(showroomBefore);
    expect(await rowsOf(fresh.clinicId)).toEqual(freshBefore);
    expect(await sharedCounts()).toEqual(shared);

    // Stripe first, the subscription before the customer; then Clerk.
    expect(stripe.calls).toEqual([`cancel ${demo.subscriptionId}`, `delete ${demo.customerId}`]);
    expect(stripe.customers.has(showroom.customerId)).toBe(true);
    expect(clerk.calls).toEqual([`delete org ${demo.orgId}`, `delete user ${userA}`]);
    expect(clerk.orgs.has(showroom.orgId)).toBe(true);
    expect(clerk.orgs.has(fresh.orgId)).toBe(true);
  });

  it("deleting one clinic's rows leaves another clinic's rows exactly as they were", async () => {
    const one = await makeFullClinic(label("one"), OLD, [`user_fake_${tag}_one`]);
    const other = await makeFullClinic(label("other"), OLD, [`user_fake_${tag}_other`]);
    const otherBefore = await rowsOf(other.clinicId);

    const outcome = await deleteClinicForCleanup(one.clinicId, { keepClinicIds: [], createdBefore: NOW });

    expect(outcome.outcome).toBe("deleted");
    expect(await rowsOf(one.clinicId)).toEqual(ALL_GONE);
    expect(await rowsOf(other.clinicId)).toEqual(otherBefore);
  });

  it("the delete itself refuses a kept or too-new clinic, whatever the caller worked out", async () => {
    const kept = await makeFullClinic(label("kept"), OLD);
    const fresh = await makeFullClinic(label("fresh"), TOO_NEW);
    const keptBefore = await rowsOf(kept.clinicId);

    expect(await deleteClinicForCleanup(kept.clinicId, { keepClinicIds: [kept.clinicId], createdBefore: NOW })).toMatchObject({ outcome: "refused" });
    expect(await deleteClinicForCleanup(fresh.clinicId, { keepClinicIds: [], createdBefore: TOO_NEW })).toMatchObject({ outcome: "refused" });
    expect(await rowsOf(kept.clinicId)).toEqual(keptBefore);
    expect((await rowsOf(fresh.clinicId)).Clinic).toBe(1);
  });

  it("refuses to start when a clinic on the keep list does not exist, and changes nothing", async () => {
    const demo = await makeFullClinic(label("demo"), OLD);
    const before = await rowsOf(demo.clinicId);

    const result = await runDemoCleanup(options({ confirm: true, keepClinicIds: ["clinic_that_does_not_exist"] }));

    expect(result.exitCode).toBe(1);
    expect(lines.join("\n")).toContain("Refusing to run");
    expect(await rowsOf(demo.clinicId)).toEqual(before);
    expect(stripe.calls).toEqual([]);
    expect(clerk.calls).toEqual([]);
  });

  it("a Stripe failure leaves that clinic's rows and Clerk alone, clears the next one, and ends with a non-zero exit", async () => {
    const showroom = await makeFullClinic(label("showroom"), OLD);
    const broken = await makeFullClinic(label("broken"), OLD, [`user_fake_${tag}_broken`]);
    const fine = await makeFullClinic(label("fine"), OLD);
    const brokenBefore = await rowsOf(broken.clinicId);
    stripe.failFor.add(broken.customerId);

    const result = await runDemoCleanup(options({ confirm: true, keepClinicIds: [showroom.clinicId] }));

    expect(result.exitCode).toBe(1);
    expect(result.failed).toEqual([broken.clinicId]);
    expect(result.cleared).toEqual([fine.clinicId]);
    expect(await rowsOf(broken.clinicId)).toEqual(brokenBefore);
    expect(clerk.orgs.has(broken.orgId)).toBe(true);
    expect(clerk.calls).not.toContain(`delete org ${broken.orgId}`);
    expect(await rowsOf(fine.clinicId)).toEqual(ALL_GONE);
    const text = lines.join("\n");
    expect(text).toContain("StripeConnectionError");
    expect(text).not.toContain("fake outage");

    // Stripe recovers: running it again finishes the job.
    stripe.failFor.clear();
    lines = [];
    const again = await runDemoCleanup(options({ confirm: true, keepClinicIds: [showroom.clinicId] }));
    expect(again.exitCode).toBe(0);
    expect(again.cleared).toEqual([broken.clinicId]);
    expect(await rowsOf(broken.clinicId)).toEqual(ALL_GONE);
  });

  it("refuses to start when the Stripe key belongs to another account, or the account cannot be asked, and changes nothing", async () => {
    const showroom = await makeFullClinic(label("showroom"), OLD);
    const demo = await makeFullClinic(label("demo"), OLD, [`user_fake_${tag}_acct`]);
    const before = await rowsOf(demo.clinicId);

    stripe.account = "acct_fakeproduction";
    const wrong = await runDemoCleanup(options({ confirm: true, keepClinicIds: [showroom.clinicId] }));
    expect(wrong.exitCode).toBe(1);
    expect(lines.join("\n")).toContain("different Stripe account");
    expect(lines.join("\n")).not.toContain("acct_");

    stripe.account = DEMO_ACCOUNT;
    stripe.accountFails = true;
    lines = [];
    const unreachable = await runDemoCleanup(options({ confirm: true, keepClinicIds: [showroom.clinicId] }));
    expect(unreachable.exitCode).toBe(1);
    expect(lines.join("\n")).toContain("StripeConnectionError");

    expect(await rowsOf(demo.clinicId)).toEqual(before);
    expect(stripe.calls).toEqual([]);
    expect(clerk.calls).toEqual([]);
  });

  it("skips a clinic whose Stripe records name another clinic, or none: no Stripe, Clerk or row change for it", async () => {
    const showroom = await makeFullClinic(label("showroom"), OLD);
    const foreignCustomer = await makeFullClinic(label("foreigncus"), OLD, [`user_fake_${tag}_fc`]);
    const foreignSub = await makeFullClinic(label("foreignsub"), OLD, [`user_fake_${tag}_fs`]);
    const unmarked = await makeFullClinic(label("unmarked"), OLD, [`user_fake_${tag}_um`]);
    const fine = await makeFullClinic(label("fine"), OLD);
    // As if these rows had been copied from somewhere else: Stripe says the records are another clinic's, or nobody's.
    stripe.customers.set(foreignCustomer.customerId, "clinic_from_production");
    stripe.subscriptions.set(foreignSub.subscriptionId, "clinic_from_production");
    stripe.customers.set(unmarked.customerId, null);
    stripe.subscriptions.set(unmarked.subscriptionId, null);
    const before = {
      foreignCustomer: await rowsOf(foreignCustomer.clinicId),
      foreignSub: await rowsOf(foreignSub.clinicId),
      unmarked: await rowsOf(unmarked.clinicId),
    };

    // The dry run says so first.
    await runDemoCleanup(options({ keepClinicIds: [showroom.clinicId] }));
    expect(lines.filter((line) => line.includes("WILL BE SKIPPED"))).toHaveLength(3);
    lines = [];

    const result = await runDemoCleanup(options({ confirm: true, keepClinicIds: [showroom.clinicId] }));

    expect(result.exitCode).toBe(1);
    expect(result.failed.sort()).toEqual([foreignCustomer.clinicId, foreignSub.clinicId, unmarked.clinicId].sort());
    expect(result.cleared).toEqual([fine.clinicId]);
    // Only the fine clinic's Stripe records were written to.
    expect(stripe.calls).toEqual([`cancel ${fine.subscriptionId}`, `delete ${fine.customerId}`]);
    expect(clerk.calls).toEqual([`delete org ${fine.orgId}`]);
    expect(await rowsOf(foreignCustomer.clinicId)).toEqual(before.foreignCustomer);
    expect(await rowsOf(foreignSub.clinicId)).toEqual(before.foreignSub);
    expect(await rowsOf(unmarked.clinicId)).toEqual(before.unmarked);
    const text = lines.join("\n");
    expect(text).toContain("belongs to a different clinic");
    expect(text).toContain("carries no clinic id");
    expect(text).not.toContain("clinic_from_production");
    expect(text).not.toContain("cus_fake");
  });

  it("a Clerk answer it cannot read stops that clinic and deletes nobody", async () => {
    const showroom = await makeFullClinic(label("showroom"), OLD);
    const odd = `user_fake_${tag}_odd`;
    const demo = await makeFullClinic(label("oddclerk"), OLD, [odd]);
    const before = await rowsOf(demo.clinicId);
    clerk.unreadable.add(odd);

    const result = await runDemoCleanup(options({ confirm: true, keepClinicIds: [showroom.clinicId] }));

    expect(result.exitCode).toBe(1);
    expect(result.failed).toEqual([demo.clinicId]);
    expect(clerk.users.has(odd)).toBe(true);
    expect(clerk.calls.filter((call) => call.startsWith("delete user"))).toEqual([]);
    expect(await rowsOf(demo.clinicId)).toEqual(before);
  });

  it("a second run is a no-op", async () => {
    const showroom = await makeFullClinic(label("showroom"), OLD);
    await makeFullClinic(label("demo"), OLD, [`user_fake_${tag}_twice`]);
    await runDemoCleanup(options({ confirm: true, keepClinicIds: [showroom.clinicId] }));
    const shared = await sharedCounts();
    const showroomBefore = await rowsOf(showroom.clinicId);
    stripe.calls = [];
    clerk.calls = [];
    lines = [];

    const again = await runDemoCleanup(options({ confirm: true, keepClinicIds: [showroom.clinicId] }));

    expect(again.exitCode).toBe(0);
    expect(again.cleared).toEqual([]);
    expect(stripe.calls).toEqual([]);
    expect(clerk.calls).toEqual([]);
    expect(lines.join("\n")).toContain("Nothing to clear.");
    expect(await sharedCounts()).toEqual(shared);
    expect(await rowsOf(showroom.clinicId)).toEqual(showroomBefore);
  });

  it("finishes after a run that got through Stripe and Clerk but not the database: already-gone records count as done", async () => {
    const showroom = await makeFullClinic(label("showroom"), OLD);
    const userB = `user_fake_${tag}_half`;
    const demo = await makeFullClinic(label("half"), OLD, [userB]);
    // As if an earlier run had done Stripe and the organization, then stopped before deleting the user and the rows.
    stripe.customers.delete(demo.customerId);
    clerk.orgs.delete(demo.orgId);

    const result = await runDemoCleanup(options({ confirm: true, keepClinicIds: [showroom.clinicId] }));

    expect(result.exitCode).toBe(0);
    expect(result.cleared).toEqual([demo.clinicId]);
    expect(await rowsOf(demo.clinicId)).toEqual(ALL_GONE);
    expect(clerk.calls).toEqual([`delete user ${userB}`]); // found through our own seat rows
  });

  it("never deletes Pulse staff, or anyone who still belongs to another organization", async () => {
    const staff = `user_fake_${tag}_staff`;
    const shared = `user_fake_${tag}_shared`;
    const lead = `user_fake_${tag}_lead`;
    const showroom = await makeFullClinic(label("showroom"), OLD, [shared]);
    const demo = await makeFullClinic(label("demo"), OLD, [lead, staff, shared]);
    clerk.users.set(staff, { pulseStaff: true });

    const result = await runDemoCleanup(options({ confirm: true, keepClinicIds: [showroom.clinicId] }));

    expect(result.exitCode).toBe(0);
    expect(clerk.users.has(staff)).toBe(true);
    expect(clerk.users.has(shared)).toBe(true);
    expect(clerk.users.has(lead)).toBe(false);
    expect(clerk.calls).toEqual([`delete org ${demo.orgId}`, `delete user ${lead}`]);
    expect(lines.join("\n")).toContain("1 people deleted who belonged to no other organization; 1 Pulse staff kept; 1 kept because they belong to another organization");
  });
});
