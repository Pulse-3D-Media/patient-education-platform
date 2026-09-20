import { Prisma, type BillingEventStatus, type BillingInterval, type Category, type ClinicStatus } from "@prisma/client";
import {
  NO_BILLING,
  decideBilling,
  effectiveAccess,
  sameBillingFacts,
  type BillingFacts,
  type SubscriptionSnapshot,
} from "../billing-state";
import { readClinicLocked } from "./clinic-lock";
import { prisma } from "./client";
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
 * signed-in admin (checkout, later), from /pulse after the staff check, or
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
      scheduledChangeAt: true,
      currentPlan: { select: PLAN_SELECT },
      pendingPlan: { select: PLAN_SELECT },
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
 * would ever be matched to it. Checkout (a later step) calls this before it
 * creates anything else in Stripe, so that by the time Stripe sends news
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
 * Write down the plan a clinic accepted and make it the one waiting for a
 * first payment. The plan row is never edited afterwards. An earlier plan
 * that was waiting is left in the table as history and simply stops being
 * pointed at.
 *
 * Refused while the clinic has a live subscription: changing a plan that is
 * being paid for is its own, later, step (proration, scheduled reductions).
 */
export async function recordAcceptedPlan(clinicId: string, input: AcceptedPlanInput) {
  checkPlan(input);
  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { id: true });
    if (!clinic) throw new BillingRefusedError("That clinic no longer exists.");
    const facts = await readBillingFacts(tx, clinicId);
    if (facts.status === "ACTIVE" || facts.status === "PAST_DUE") {
      throw new BillingRefusedError("This clinic already has a subscription. Changing a plan that is being paid for is not built yet.");
    }
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

    const settings = await readSettingsIn(tx);
    const decision = decideBilling(current, snap, now, settings.graceDays);

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
        lastReconciledAt: now,
      },
      select: { clinicId: true },
    });

    // 2. The plan, when a first payment was just confirmed. A managed
    //    clinic keeps the plan and the access Pulse staff gave it.
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
          `Plan started: ${plan.entitledCategories.length} ${plan.entitledCategories.length === 1 ? "category" : "categories"}, ${plan.surgeonSeats} ${plan.surgeonSeats === 1 ? "seat" : "seats"}.`,
        );
        if (staffAccess === "OPEN") {
          // The one hand setting billing ever clears, and only this one, only
          // here (see the top of lib/billing-state.ts).
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

    const outcome = entries.length > 0 ? entries.join(" ") : recordChanged ? "Dates updated from Stripe." : "Checked against Stripe. Nothing had changed.";
    await finish("PROCESSED", outcome);
    return { kind: "processed", outcome, logged: entries.length > 0 ? 1 : 0 };
  }, TX_OPTIONS);
}
