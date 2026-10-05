import { Prisma, type BillingEventStatus, type BillingInterval, type Category, type ClinicStatus } from "@prisma/client";
import {
  NO_BILLING,
  SELF_SERVE_REFUSALS,
  decideBilling,
  effectiveAccess,
  sameBillingFacts,
  selfServeEligibility,
  type BillingFacts,
  type SubscriptionSnapshot,
} from "../billing-state";
import { attemptIsReusable, samePlanShape } from "../checkout-rules";
import { checkSeatReduction, overAllocatedWords, seatSummary } from "../seats";
import { readClinicLocked } from "./clinic-lock";
import { prisma } from "./client";
import { countSeatsInUseIn } from "./seats";
import { readSettingsIn } from "./settings";

/**
 * Every billing query. Three tables:
 *
 *   ClinicBilling   Stripe's side of one clinic: the financial record.
 *   BillingPlan     the plans a clinic accepted. Written once, never edited.
 *   BillingEvent    one row per notification from Stripe, by Stripe's own
 *                   event id, which is what makes a repeat harmless.
 *
 * The one rule that matters here: EVERYTHING THAT CHANGES A CLINIC'S BILLING
 * OR ITS ACCESS HAPPENS IN ONE TRANSACTION THAT HOLDS THE CLINIC'S ROW LOCK
 * (readClinicLocked, the same lock every staff change to a clinic takes).
 * Two notifications about one clinic, or a notification and a staff pause,
 * therefore happen one after the other, never at once, and each reads what
 * the one before it wrote.
 *
 * Inside that lock the code asks Stripe where the subscription stands NOW
 * and applies that (decideBilling in lib/billing-state.ts), rather than
 * applying what the notification said. So it does not matter in what order
 * notifications arrive, how late, or how many times: whichever is handled
 * last has the freshest answer, and handling the same state twice changes
 * nothing and logs nothing.
 *
 * The clinic id these functions take comes from the server: from the
 * signed-in admin (checkout), from /pulse after the staff check, or
 * from looking a clinic up by the Stripe customer on a verified
 * notification. Never from a browser form.
 */

/** The ordinary client, or the client inside a transaction. */
type Db = Prisma.TransactionClient | typeof prisma;

/** Who the log says did it, for every entry billing writes. */
export const BILLING_AUTHOR = "billing";

/** Thrown when a billing write is refused. The message is a plain sentence, safe to show to staff. */
export class BillingRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingRefusedError";
  }
}

const FACTS_SELECT = {
  status: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  pendingPlanId: true,
  currentPlanId: true,
  currentPeriodEnd: true,
  cancelAt: true,
  paymentFailedAt: true,
  graceEndsAt: true,
  scheduledPlanId: true,
  scheduledChangeAt: true,
} as const;

/** One clinic's financial record, as the rules read it. A clinic with no row has NO_BILLING. */
export async function readBillingFacts(db: Db, clinicId: string): Promise<BillingFacts> {
  const row = await db.clinicBilling.findUnique({ where: { clinicId }, select: FACTS_SELECT });
  return row ?? NO_BILLING;
}

const PLAN_SELECT = {
  id: true,
  pricingVersionId: true,
  categories: true,
  entitledCategories: true,
  surgeonSeats: true,
  interval: true,
  perSeatCents: true,
  totalCents: true,
  acceptedByName: true,
  createdAt: true,
  pricingVersion: { select: { version: true } },
} as const;

/** Everything /pulse shows about one clinic's billing: the record, and the plans it points at. Null when the clinic has none. */
export async function getClinicBilling(clinicId: string) {
  return prisma.clinicBilling.findUnique({
    where: { clinicId },
    select: {
      ...FACTS_SELECT,
      lastReconciledAt: true,
      currentPlan: { select: PLAN_SELECT },
      pendingPlan: { select: PLAN_SELECT },
      scheduledPlan: { select: PLAN_SELECT },
    },
  });
}

/** Which clinic a Stripe customer belongs to, or null. stripeCustomerId is unique, so at most one. */
export async function findClinicIdByStripeCustomer(stripeCustomerId: string): Promise<string | null> {
  const row = await prisma.clinicBilling.findUnique({ where: { stripeCustomerId }, select: { clinicId: true } });
  return row?.clinicId ?? null;
}

/** How long a billing transaction may run. Longer than Prisma's five seconds because it waits on Stripe (eight at most, see lib/stripe.ts). */
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/**
 * Record the Stripe customer made for a clinic. Set once: asking again with
 * the same id changes nothing, and a different id is refused, because a
 * clinic with two customers could be charged twice and only one of them
 * would ever be matched to it. Checkout (lib/checkout.ts) calls this before
 * it creates anything else in Stripe, so that by the time Stripe sends news
 * about the customer, the clinic can be found.
 */
export async function setStripeCustomer(clinicId: string, stripeCustomerId: string) {
  if (!/^cus_[A-Za-z0-9_]+$/.test(stripeCustomerId)) throw new BillingRefusedError("That is not a Stripe customer id.");
  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { id: true });
    if (!clinic) throw new BillingRefusedError("That clinic no longer exists.");
    const existing = await tx.clinicBilling.findUnique({ where: { clinicId }, select: { stripeCustomerId: true } });
    if (existing?.stripeCustomerId && existing.stripeCustomerId !== stripeCustomerId) {
      throw new BillingRefusedError("This clinic already has a Stripe customer. A second one is never attached.");
    }
    return tx.clinicBilling.upsert({
      where: { clinicId },
      create: { clinicId, stripeCustomerId },
      update: { stripeCustomerId },
      select: FACTS_SELECT,
    });
  }, TX_OPTIONS);
}

/** A plan as a clinic accepted it. Every amount comes from the pricing engine on the server (rule 8), never from a form. */
export type AcceptedPlanInput = {
  pricingVersionId: string;
  categories: Category[];
  entitledCategories: Category[];
  surgeonSeats: number;
  interval: BillingInterval;
  perSeatCents: number;
  totalCents: number;
  acceptedById: string;
  acceptedByName: string;
};

const MAX_CENTS = 2_000_000_000; // what a Postgres integer holds, near enough

function checkPlan(input: AcceptedPlanInput) {
  const whole = (n: number, min: number) => Number.isInteger(n) && n >= min && n <= MAX_CENTS;
  if (!whole(input.surgeonSeats, 1)) throw new BillingRefusedError("A plan needs at least one surgeon seat.");
  if (!whole(input.perSeatCents, 0) || !whole(input.totalCents, 0)) throw new BillingRefusedError("The plan's amounts are not whole cents.");
  if (input.totalCents !== input.perSeatCents * input.surgeonSeats) throw new BillingRefusedError("The plan's total is not its per-seat amount times its seats.");
  if (input.categories.length === 0) throw new BillingRefusedError("A plan needs at least one category.");
  if (new Set(input.categories).size !== input.categories.length) throw new BillingRefusedError("A category is on the plan twice.");
  if (new Set(input.entitledCategories).size !== input.entitledCategories.length) throw new BillingRefusedError("A category is included twice.");
  if (!input.categories.every((category) => input.entitledCategories.includes(category))) {
    throw new BillingRefusedError("The plan does not include a category it charges for.");
  }
  if (!input.acceptedById || !input.acceptedByName) throw new BillingRefusedError("A plan has to say who accepted it.");
}

/**
 * A plan may not be accepted with fewer surgeon seats than people hold right
 * now (a clinic Pulse opened by hand can have surgeons seated before it ever
 * pays by card). This is the "when it is scheduled" half of the rule in
 * lib/seats.ts; the count is read under the clinic's lock, which the caller
 * holds. The message tells the admin what to do about it.
 *
 * A change to a paid plan calls this too, when the change is accepted
 * (acceptPlanForChange), and the place that applies it checks again (see
 * reconcileSubscription below for how "when it takes effect" is handled).
 */
async function refuseFewerSeatsThanInUse(tx: Prisma.TransactionClient, clinicId: string, surgeonSeats: number) {
  const check = checkSeatReduction(await countSeatsInUseIn(tx, clinicId), surgeonSeats);
  if (!check.ok) throw new BillingRefusedError(check.message);
}

/**
 * Write down the plan a clinic accepted and make it the one waiting for a
 * first payment. The plan row is never edited afterwards. An earlier plan
 * that was waiting is left in the table as history and simply stops being
 * pointed at.
 *
 * Refused while the clinic has a live subscription: changing a plan that is
 * being paid for is its own, later, step (proration, scheduled reductions).
 *
 * The plain writer. Checkout uses acceptPlanForCheckout (further down),
 * which also checks who may pay and finds an identical recent attempt
 * instead of writing a second one.
 */
export async function recordAcceptedPlan(clinicId: string, input: AcceptedPlanInput) {
  checkPlan(input);
  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { id: true });
    if (!clinic) throw new BillingRefusedError("That clinic no longer exists.");
    const facts = await readBillingFacts(tx, clinicId);
    if (facts.status === "ACTIVE" || facts.status === "PAST_DUE") {
      throw new BillingRefusedError("This clinic already has a subscription. A plan that is being paid for is changed on the Billing page, not replaced.");
    }
    await refuseFewerSeatsThanInUse(tx, clinicId, input.surgeonSeats);
    const plan = await tx.billingPlan.create({ data: { clinicId, ...input }, select: { id: true } });
    await tx.clinicBilling.upsert({
      where: { clinicId },
      create: { clinicId, pendingPlanId: plan.id },
      update: { pendingPlanId: plan.id },
      select: { clinicId: true },
    });
    return plan;
  }, TX_OPTIONS);
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/** What the Billing page and the checkout flow read about one clinic, in one query. */
export async function getCheckoutFacts(clinicId: string) {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      name: true,
      practiceType: true,
      managedByPulse: true,
      staffAccess: true,
      billing: { select: { ...FACTS_SELECT, currentPlan: { select: PLAN_SELECT }, pendingPlan: { select: PLAN_SELECT }, scheduledPlan: { select: PLAN_SELECT } } },
    },
  });
  if (!clinic) return null;
  const { billing, ...rest } = clinic;
  return {
    ...rest,
    facts: billing
      ? {
          status: billing.status,
          stripeCustomerId: billing.stripeCustomerId,
          stripeSubscriptionId: billing.stripeSubscriptionId,
          pendingPlanId: billing.pendingPlanId,
          currentPlanId: billing.currentPlanId,
          currentPeriodEnd: billing.currentPeriodEnd,
          cancelAt: billing.cancelAt,
          paymentFailedAt: billing.paymentFailedAt,
          graceEndsAt: billing.graceEndsAt,
          scheduledPlanId: billing.scheduledPlanId,
          scheduledChangeAt: billing.scheduledChangeAt,
        }
      : NO_BILLING,
    currentPlan: billing?.currentPlan ?? null,
    pendingPlan: billing?.pendingPlan ?? null,
    scheduledPlan: billing?.scheduledPlan ?? null,
  };
}

export type CheckoutFacts = NonNullable<Awaited<ReturnType<typeof getCheckoutFacts>>>;

/** The purchase attempt a checkout page is made for. */
export type PurchaseAttempt = {
  planId: string;
  /** When the attempt was written. The checkout page's expiry is worked out from this, so asking twice gives the same page. */
  createdAt: Date;
  /** True when an identical attempt from a moment ago was found and used again, instead of a second one being written. */
  reused: boolean;
};

/**
 * Write down the plan an admin just accepted as a PURCHASE ATTEMPT, or find
 * the identical one they made a moment ago. This is the durable record that
 * makes a double click, a retry and a second browser tab harmless:
 *
 *   - It runs under the clinic's row lock, so two requests for one clinic
 *     happen one after the other. The second one reads what the first wrote.
 *   - If the plan already waiting is the same in every way that is charged
 *     for or included, and it is recent, THAT attempt is returned again.
 *     Both requests then ask Stripe for a payment page with the same
 *     idempotency key (built from the attempt's id), and Stripe hands both
 *     the same page. One attempt, one page, at most one subscription.
 *   - A different selection writes a new row and points "waiting" at it. The
 *     earlier row is never edited; the caller closes its payment page.
 *
 * Everything that could have changed since the page was drawn is checked
 * again here, under the lock: who may pay by card (a clinic marked managed
 * or paused by Pulse a second ago is refused), and whether a subscription
 * has started in the meantime.
 *
 * The Stripe customer must already be on file (setStripeCustomer). That
 * order is what lets a notification about the purchase find its clinic.
 */
export async function acceptPlanForCheckout(
  clinicId: string,
  input: AcceptedPlanInput,
  options: { now?: Date; forceNew?: boolean } = {},
): Promise<PurchaseAttempt> {
  checkPlan(input);
  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { id: true, practiceType: true, managedByPulse: true, staffAccess: true });
    // The clock is read AFTER the lock is held, so it is later than anything an earlier request wrote while this one waited.
    const now = options.now ?? new Date();
    if (!clinic) throw new BillingRefusedError("That clinic no longer exists.");

    const eligibility = selfServeEligibility(clinic);
    if (!eligibility.eligible) throw new BillingRefusedError(SELF_SERVE_REFUSALS[eligibility.reason]);

    const facts = await readBillingFacts(tx, clinicId);
    if (facts.status === "ACTIVE" || facts.status === "PAST_DUE") {
      throw new BillingRefusedError("Your clinic already has a subscription, so a second one was not started.");
    }
    if (!facts.stripeCustomerId) throw new BillingRefusedError("The clinic has no Stripe customer yet, so checkout cannot start.");
    await refuseFewerSeatsThanInUse(tx, clinicId, input.surgeonSeats);

    // forceNew: the caller found that the earlier attempt's payment page has closed, so that attempt cannot be paid any more.
    if (facts.pendingPlanId && !options.forceNew) {
      const waiting = await tx.billingPlan.findUnique({
        where: { id: facts.pendingPlanId },
        select: { id: true, clinicId: true, createdAt: true, pricingVersionId: true, categories: true, entitledCategories: true, surgeonSeats: true, interval: true, perSeatCents: true, totalCents: true },
      });
      if (waiting && waiting.clinicId === clinicId && samePlanShape(waiting, input) && attemptIsReusable(waiting.createdAt, now)) {
        return { planId: waiting.id, createdAt: waiting.createdAt, reused: true };
      }
    }

    const plan = await tx.billingPlan.create({ data: { clinicId, ...input }, select: { id: true, createdAt: true } });
    await tx.clinicBilling.update({ where: { clinicId }, data: { pendingPlanId: plan.id }, select: { clinicId: true } });
    return { planId: plan.id, createdAt: plan.createdAt, reused: false };
  }, TX_OPTIONS);
}

// ---------------------------------------------------------------------------
// Changing a plan that is being paid for
// ---------------------------------------------------------------------------

/** When a change takes effect: now (an upgrade, once its payment succeeds) or at the next renewal (everything else). */
export type ChangeTiming = "now" | "renewal";

/**
 * Write down the plan a clinic's account owner just accepted as a CHANGE to
 * the plan it is paying for. Like every accepted plan, the row is written
 * once and never edited.
 *
 * Nothing here changes what the clinic has or pays. The row is only what
 * the Stripe price for the change is marked with; the change becomes real
 * when Stripe says the subscription is on that price (an upgrade whose
 * payment succeeded, or a scheduled change whose date came), and
 * reconcileSubscription applies it then. A row whose change never happens
 * (a declined card, a change cancelled before renewal) stays as history.
 *
 * Everything that could have changed since the page was drawn is checked
 * again here, under the clinic's row lock:
 *
 *   - who may pay by card (a clinic marked managed, a hospital, or paused by
 *     hand a second ago is refused);
 *   - that the subscription is paid up and not set to end;
 *   - that the plan being changed FROM is still the plan in force
 *     (`basePlanId`), so two tabs cannot both change "the plan I was looking at";
 *   - that no other change is in the way;
 *   - the seat floor: never fewer seats than are taken right now, by people
 *     and open invitations together. This is the "when it is scheduled" half
 *     of the rule in lib/seats.ts.
 */
export async function acceptPlanForChange(
  clinicId: string,
  input: AcceptedPlanInput,
  options: { basePlanId: string; timing: ChangeTiming },
): Promise<{ planId: string }> {
  checkPlan(input);
  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { id: true, practiceType: true, managedByPulse: true, staffAccess: true });
    if (!clinic) throw new BillingRefusedError("That clinic no longer exists.");

    const eligibility = selfServeEligibility(clinic);
    if (!eligibility.eligible) throw new BillingRefusedError(SELF_SERVE_REFUSALS[eligibility.reason]);

    const facts = await readBillingFacts(tx, clinicId);
    if (facts.status === "PAST_DUE") throw new BillingRefusedError("Your last payment did not go through. Settle that first, then change your plan.");
    if (facts.status !== "ACTIVE" || !facts.currentPlanId) throw new BillingRefusedError("Your clinic has no subscription to change.");
    if (facts.cancelAt) throw new BillingRefusedError("Your subscription is set to end. Keep it going first, then change your plan.");
    if (facts.currentPlanId !== options.basePlanId) throw new BillingRefusedError(PLAN_MOVED_MESSAGE);
    if (facts.pendingPlanId) throw new BillingRefusedError("A plan change is waiting for its payment. Pay for it or cancel it first.");
    if (options.timing === "now" && facts.scheduledPlanId) {
      throw new BillingRefusedError("A change is already scheduled for your next renewal. Cancel that one first, then make this one.");
    }
    await refuseFewerSeatsThanInUse(tx, clinicId, input.surgeonSeats);

    const plan = await tx.billingPlan.create({ data: { clinicId, ...input }, select: { id: true } });
    return { planId: plan.id };
  }, TX_OPTIONS);
}

/** What an owner is told when the plan was changed by someone else between drawing the page and pressing the button. */
export const PLAN_MOVED_MESSAGE = "Your plan changed a moment ago. Reload this page and check it before changing anything.";

/** Longer than TX_OPTIONS: a plan change asks Stripe two or three things while the lock is held, each bounded at eight seconds. */
const CHANGE_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/**
 * Run one clinic's plan change while holding the clinic's row lock, so two
 * plan changes for one clinic (two tabs, a double click, two admins) happen
 * one after the other, never at once. The second one starts by asking Stripe
 * where the subscription stands, and sees what the first one did.
 *
 * `work` talks to Stripe and writes NOTHING to the database: if this
 * transaction fails after Stripe has made the change, nothing here is lost,
 * because the change is applied from what Stripe says (reconcileSubscription),
 * by the caller straight afterwards and by Stripe's own notification.
 */
export async function withPlanChangeLock<T>(clinicId: string, work: () => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { id: true });
    if (!clinic) throw new BillingRefusedError("That clinic no longer exists.");
    return work();
  }, CHANGE_TX_OPTIONS);
}

/** One accepted plan of one clinic, in the shape two plans are compared by, or null when it is not this clinic's. */
export async function getPlanShape(clinicId: string, planId: string) {
  const plan = await prisma.billingPlan.findUnique({
    where: { id: planId },
    select: { clinicId: true, pricingVersionId: true, categories: true, entitledCategories: true, surgeonSeats: true, interval: true, perSeatCents: true, totalCents: true },
  });
  if (!plan || plan.clinicId !== clinicId) return null;
  return plan;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const EVENT_SELECT = {
  id: true,
  stripeEventId: true,
  type: true,
  clinicId: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  status: true,
  outcome: true,
  attempts: true,
  lastErrorCode: true,
  receivedAt: true,
  processedAt: true,
} as const;

export type BillingEventRow = Prisma.BillingEventGetPayload<{ select: typeof EVENT_SELECT }>;

/** True once nothing more will be done for a notification. */
export function isFinished(status: BillingEventStatus): boolean {
  return status === "PROCESSED" || status === "IGNORED";
}

/**
 * Write a notification down, once. The unique constraint on Stripe's event
 * id does the work: the first delivery inserts the row; a repeat (or two
 * deliveries arriving together) hits the constraint and gets the row that
 * is already there instead. `fresh` says which happened.
 *
 * Insert first and catch the refusal, never look-then-insert: two
 * deliveries at the same moment would both look, both find nothing, and
 * both insert.
 */
export async function receiveBillingEvent(event: {
  stripeEventId: string;
  type: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}): Promise<{ row: BillingEventRow; fresh: boolean }> {
  try {
    const row = await prisma.billingEvent.create({ data: event, select: EVENT_SELECT });
    return { row, fresh: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const row = await prisma.billingEvent.findUnique({ where: { stripeEventId: event.stripeEventId }, select: EVENT_SELECT });
      if (row) return { row, fresh: false };
    }
    throw error;
  }
}

/** One notification by our own row id, for the Try again button. */
export async function getBillingEvent(id: string) {
  return prisma.billingEvent.findUnique({ where: { id }, select: EVENT_SELECT });
}

/** Count one more attempt, before the work starts. */
export async function beginBillingAttempt(id: string) {
  await prisma.billingEvent.update({ where: { id }, data: { attempts: { increment: 1 } }, select: { id: true } });
}

/** Note which clinic a notification turned out to be about, as soon as it is known, so a failed one can be traced to its clinic. */
export async function setBillingEventClinic(id: string, clinicId: string) {
  await prisma.billingEvent.update({ where: { id }, data: { clinicId }, select: { id: true } });
}

/** Close a notification with nothing done, and say why. Used for the cases decided before any clinic is locked. */
export async function ignoreBillingEvent(id: string, outcome: string, clinicId: string | null = null) {
  await prisma.billingEvent.update({
    where: { id },
    data: { status: "IGNORED", outcome, processedAt: new Date(), lastErrorCode: null, ...(clinicId ? { clinicId } : {}) },
    select: { id: true },
  });
}

/**
 * Record that the work threw. Only the KIND of error is kept (a class name
 * or a code), never its message, which could carry an id, an address or
 * part of a key. A notification already finished by another attempt is
 * left alone.
 */
export async function markBillingEventFailed(id: string, errorCode: string) {
  await prisma.billingEvent.updateMany({
    where: { id, status: { in: ["RECEIVED", "FAILED"] } },
    data: { status: "FAILED", lastErrorCode: errorCode.slice(0, 60) },
  });
}

/** How the outcome of a notification that a person should check begins. /pulse/billing finds them by it. */
export const NEEDS_LOOK = "Needs a look: ";

/** A notification written down but not finished after this long has probably lost its process. */
const STUCK_AFTER_MS = 10 * 60 * 1000;

function attentionWhere(now: Date): Prisma.BillingEventWhereInput {
  return {
    OR: [
      { status: "FAILED" },
      { status: "RECEIVED", receivedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
      { outcome: { startsWith: NEEDS_LOOK } },
    ],
  };
}

/** Does this row belong in "needs attention"? The same rule as the query above, for one row already in hand. */
export function needsAttention(row: Pick<BillingEventRow, "status" | "receivedAt" | "outcome">, now: Date = new Date()): boolean {
  if (row.status === "FAILED") return true;
  if (row.status === "RECEIVED" && row.receivedAt.getTime() < now.getTime() - STUCK_AFTER_MS) return true;
  return row.outcome?.startsWith(NEEDS_LOOK) ?? false;
}

/** The most notifications /pulse/billing ever lists. */
export const BILLING_EVENT_LIMIT = 100;

/** The newest notifications, newest first, bounded. `attention` narrows to the ones a person should look at. */
export async function listBillingEvents(filter: { attention?: boolean } = {}, now: Date = new Date()) {
  return prisma.billingEvent.findMany({
    where: filter.attention ? attentionWhere(now) : {},
    orderBy: { receivedAt: "desc" },
    take: BILLING_EVENT_LIMIT,
    select: EVENT_SELECT,
  });
}

/** How many notifications need a person to look. Counted in the database. */
export async function countBillingEventsNeedingAttention(now: Date = new Date()): Promise<number> {
  return prisma.billingEvent.count({ where: attentionWhere(now) });
}

// ---------------------------------------------------------------------------
// Reconciling one clinic with Stripe
// ---------------------------------------------------------------------------

export type ReconcileResult = {
  /** What became of it: work done, nothing to do, or another attempt had already finished this notification. */
  kind: "processed" | "ignored" | "already-done";
  /** One plain sentence, the same one stored on the notification. */
  outcome: string;
  /** How many log entries were written: 1 when something a person cares about changed, 0 otherwise. */
  logged: number;
};

/** What the locked read asks for about the clinic. */
const RECONCILE_CLINIC = { id: true, status: true, graceEndsAt: true, staffAccess: true, managedByPulse: true } as const;

const STATUS_WORDS: Record<ClinicStatus, string> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  PAUSED: "Paused",
  PAST_DUE: "Past due",
  CANCELED: "Canceled",
};

/**
 * Bring one clinic's billing, and its access, into line with what Stripe
 * says about one subscription right now. See the top of this file for why
 * it is shaped this way.
 *
 *   fetchSubscription   how to ask Stripe (lib/stripe.ts in the app; a
 *                       stand-in in the tests). Called INSIDE the lock, so
 *                       what it returns cannot be older than what any
 *                       earlier transaction applied.
 *   eventId             the BillingEvent row this work is for, when there
 *                       is one. It is marked finished in the SAME
 *                       transaction as the changes, so "finished" can never
 *                       be true of work that did not commit: if the process
 *                       dies first, everything rolls back, the row is still
 *                       unfinished, and Stripe's next delivery does the work.
 *   now                 the server's clock, a parameter for the tests.
 *
 * Throws when Stripe or the database fails; the caller records the failure
 * and answers Stripe with an error so it sends the notification again.
 */
export async function reconcileSubscription(args: {
  clinicId: string;
  subscriptionId: string;
  fetchSubscription: (subscriptionId: string) => Promise<SubscriptionSnapshot | null>;
  eventId?: string;
  now?: Date;
}): Promise<ReconcileResult> {
  const { clinicId, subscriptionId, fetchSubscription, eventId } = args;

  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, RECONCILE_CLINIC);
    if (!clinic) throw new Error("Billing: the clinic for a known Stripe customer has gone.");

    // Another attempt at the same notification may have finished while this
    // one waited for the lock. Then there is nothing left to do.
    if (eventId) {
      const event = await tx.billingEvent.findUnique({ where: { id: eventId }, select: { status: true, outcome: true } });
      if (event && isFinished(event.status)) return { kind: "already-done", outcome: event.outcome ?? "", logged: 0 };
    }

    const now = args.now ?? new Date();
    const finish = async (status: "PROCESSED" | "IGNORED", outcome: string) => {
      if (!eventId) return;
      await tx.billingEvent.update({
        where: { id: eventId },
        data: { status, outcome, clinicId, processedAt: now, lastErrorCode: null },
        select: { id: true },
      });
    };

    const current = await readBillingFacts(tx, clinicId);
    const snap = await fetchSubscription(subscriptionId);
    if (!snap) {
      const outcome = "Stripe has no such subscription in test mode. Nothing was changed.";
      await finish("IGNORED", outcome);
      return { kind: "ignored", outcome, logged: 0 };
    }

    // The plans Stripe names for a plan change (the one the subscription is
    // on, one waiting for its payment, one scheduled) are ids this server
    // wrote on its own Stripe prices. Any that is not one of THIS clinic's
    // accepted plans is not acted on: it can only come from a price changed
    // by hand in Stripe, and a person is asked to look.
    const named = [snap.itemPlanId, snap.pendingPlanId, snap.scheduledPlanId].filter((id): id is string => typeof id === "string" && id.length > 0);
    const known = new Set(
      named.length > 0 ? (await tx.billingPlan.findMany({ where: { id: { in: named }, clinicId }, select: { id: true } })).map((plan) => plan.id) : [],
    );
    const ours = (id: string | null | undefined) => (id && known.has(id) ? id : null);
    const strangePlan = named.some((id) => !known.has(id));
    const checked: SubscriptionSnapshot = {
      ...snap,
      itemPlanId: ours(snap.itemPlanId),
      pendingPlanId: ours(snap.pendingPlanId),
      scheduledPlanId: ours(snap.scheduledPlanId),
    };

    const settings = await readSettingsIn(tx);
    const decision = decideBilling(current, checked, now, settings.graceDays);

    if (decision.kind === "ignored") {
      const outcome = (decision.needsLook ? NEEDS_LOOK : "") + decision.reason;
      await finish("IGNORED", outcome);
      return { kind: "ignored", outcome, logged: 0 };
    }

    const { next, activatePlanId } = decision;
    const entries = [...decision.entries];

    // 1. The financial record. Always brought up to date, managed clinic or
    //    not, so it can be checked against Stripe.
    const recordChanged = !sameBillingFacts(current, next);
    await tx.clinicBilling.update({
      where: { clinicId },
      data: {
        status: next.status,
        stripeSubscriptionId: next.stripeSubscriptionId,
        pendingPlanId: next.pendingPlanId,
        currentPlanId: next.currentPlanId,
        currentPeriodEnd: next.currentPeriodEnd,
        cancelAt: next.cancelAt,
        paymentFailedAt: next.paymentFailedAt,
        graceEndsAt: next.graceEndsAt,
        scheduledPlanId: next.scheduledPlanId,
        scheduledChangeAt: next.scheduledChangeAt,
        lastReconciledAt: now,
      },
      select: { clinicId: true },
    });

    // 2. The plan, when a first payment was just confirmed, or when a plan
    //    change has taken effect in Stripe. A managed clinic keeps the plan
    //    and the access Pulse staff gave it.
    const clinicData: Prisma.ClinicUncheckedUpdateInput = {};
    let staffAccess = clinic.staffAccess;
    if (activatePlanId) {
      if (clinic.managedByPulse) {
        entries.push("This clinic is managed by Pulse, so its plan and access were left as staff set them.");
      } else {
        const plan = await tx.billingPlan.findUnique({
          where: { id: activatePlanId },
          select: { clinicId: true, entitledCategories: true, surgeonSeats: true, pricingVersionId: true },
        });
        if (!plan || plan.clinicId !== clinicId) throw new Error("Billing: the accepted plan does not belong to this clinic.");
        clinicData.categories = plan.entitledCategories;
        clinicData.surgeonSeats = plan.surgeonSeats;
        clinicData.pricingVersionId = plan.pricingVersionId;
        entries.push(
          `${decision.planChanged ? "The plan is now" : "Plan started:"} ${plan.entitledCategories.length} ${plan.entitledCategories.length === 1 ? "category" : "categories"}, ${plan.surgeonSeats} ${plan.surgeonSeats === 1 ? "seat" : "seats"}.`,
        );
        // The "when it takes effect" half of the seat rule. The plan was
        // checked against the seats in use when it was accepted, but people
        // can be given seats between then and the payment. The payment has
        // been made, so the plan is applied regardless; what must not happen
        // is anything silent. Nobody is relabelled, no seat is taken away and
        // no charge is changed: the log says the clinic is over its plan, and
        // nobody new can be given a seat until that is settled.
        const over = overAllocatedWords(seatSummary(plan.surgeonSeats, await countSeatsInUseIn(tx, clinicId)));
        if (over) entries.push(over);
        if (staffAccess === "OPEN" && !decision.planChanged) {
          // The one hand setting billing ever clears, and only this one, only
          // here, at a FIRST payment (see the top of lib/billing-state.ts).
          staffAccess = null;
          clinicData.staffAccess = null;
          entries.push("The clinic had been opened by hand; it now pays by card, so its access follows its payments from here on.");
        }
      }
    } else if (clinic.managedByPulse && entries.length > 0) {
      entries.push("This clinic is managed by Pulse, so its access was not changed.");
    }

    // 3. Access, worked out again from all three inputs.
    const access = effectiveAccess({
      staffAccess,
      managedByPulse: clinic.managedByPulse,
      billingStatus: next.status,
      billingGraceEndsAt: next.graceEndsAt,
    });
    const graceMoved = (access.graceEndsAt?.getTime() ?? null) !== (clinic.graceEndsAt?.getTime() ?? null);
    if (access.status !== clinic.status) {
      clinicData.status = access.status;
      clinicData.statusChangedBy = BILLING_AUTHOR;
      clinicData.statusChangedAt = now;
      clinicData.statusReason = entries.join(" ").slice(0, 300) || null;
      entries.push(`Status is now ${STATUS_WORDS[access.status]}.`);
    } else if (entries.length > 0 && clinic.staffAccess !== null && staffAccess !== null && !clinic.managedByPulse) {
      entries.push(`Status stays ${STATUS_WORDS[clinic.status]}: it was set by hand, and that wins over billing.`);
    }
    if (graceMoved) clinicData.graceEndsAt = access.graceEndsAt;
    if (Object.keys(clinicData).length > 0) {
      await tx.clinic.update({ where: { id: clinicId }, data: clinicData, select: { id: true } });
    }

    // 4. One log entry for this real change; none when nothing changed.
    if (entries.length > 0) {
      await tx.clinicNote.create({
        data: { clinicId, kind: "STATUS", body: `Billing: ${entries.join(" ")}`, authorName: BILLING_AUTHOR },
        select: { id: true },
      });
    }

    const words = entries.length > 0 ? entries.join(" ") : recordChanged ? "Dates updated from Stripe." : "Checked against Stripe. Nothing had changed.";
    const outcome = strangePlan
      ? `${NEEDS_LOOK}The subscription in Stripe names a plan this app did not make for this clinic, so that part was not acted on. Check its price and schedule in Stripe. ${words}`
      : words;
    await finish("PROCESSED", outcome);
    return { kind: "processed", outcome, logged: entries.length > 0 ? 1 : 0 };
  }, TX_OPTIONS);
}
