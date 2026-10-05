import type { SubscriptionSnapshot } from "../billing-state";
import type { PlanGateway, SubscriptionState } from "../stripe";

/**
 * An in-memory stand-in for the parts of Stripe a plan change uses, for the
 * tests. Nothing in the app imports it.
 *
 * It behaves the way the real Stripe was SEEN to behave in test mode
 * (October 2026, on a Stripe test clock) where these rules depend on it:
 *
 *   - A price is made once per accepted plan and carries that plan's id.
 *   - An upgrade is charged at once. If the card works, the subscription
 *     moves to the new price. If the card is declined, or the bank wants the
 *     admin to approve the charge, the subscription DOES NOT MOVE: Stripe
 *     keeps the change aside ("pending") with an unpaid invoice. Paying that
 *     invoice applies the change; voiding it drops the change.
 *   - Asking for the same upgrade twice (same plan id) gives the first answer.
 *   - A subscription has at most one schedule. A scheduled change happens at
 *     the renewal: the subscription moves to the new price, its line gets a
 *     NEW id, and the schedule stays attached, with nothing left to do, until
 *     it is released.
 *   - While a schedule is attached, Stripe refuses to cancel the subscription.
 *
 * It is not Stripe. What Stripe really does is checked separately, against
 * Stripe's own test mode.
 */

type Interval = "MONTH" | "YEAR";
type Card = "good" | "declined" | "needs-approval";

type FakePrice = { id: string; planId: string | null; unitAmount: number; interval: Interval };
type FakeInvoice = { id: string; status: "paid" | "open" | "void"; dueCents: number };
type FakeSubscription = {
  id: string;
  customerId: string;
  status: string;
  /** The plan checkout wrote on the subscription itself. */
  metadataPlanId: string | null;
  itemId: string;
  priceId: string;
  quantity: number;
  periodStart: Date;
  periodEnd: Date;
  cancelAt: Date | null;
  latestInvoice: FakeInvoice;
  pending: { priceId: string; quantity: number; invoiceId: string } | null;
  schedule: { id: string; next: { priceId: string; quantity: number; planId: string; interval: Interval } | null } | null;
};

const DAY = 24 * 60 * 60 * 1000;
const periodLength = (interval: Interval) => (interval === "YEAR" ? 365 : 30) * DAY;

/** One counter for every stand-in in a test file, so no two made-up ids are ever the same (customer ids are unique in the database). */
let serial = 0;

export function fakePlanStripe(tag: string) {
  const next = (prefix: string) => `${prefix}_vitest${tag}${(serial += 1)}`;

  const prices = new Map<string, FakePrice>();
  const priceByPlan = new Map<string, string>();
  const subscriptions = new Map<string, FakeSubscription>();
  const cards = new Map<string, Card>();
  const upgradeAnswers = new Map<string, { applied: boolean }>();
  const portalVisits: { customerId: string; returnUrl: string }[] = [];
  const calls = { ensurePrice: 0, previewUpgrade: 0, applyUpgrade: 0, scheduleChange: 0, releaseSchedule: 0, voidInvoice: 0, createPortalSession: 0 };
  /** Set to make the next call of that name throw, as a Stripe outage would. */
  const failNext: Partial<Record<keyof typeof calls | "getState", boolean>> = {};
  /** Runs once, inside applyUpgrade or scheduleChange, before Stripe "does" anything. For forcing an overlap. */
  let beforeChange: (() => Promise<void>) | null = null;

  const priceOf = (id: string) => prices.get(id) as FakePrice;
  const sub = (id: string) => {
    const found = subscriptions.get(id);
    if (!found) throw new Error("No such fake subscription.");
    return found;
  };
  const outage = (name: keyof typeof failNext) => {
    if (failNext[name]) {
      failNext[name] = false;
      throw Object.assign(new Error("Stripe is not answering (made up for a test)."), { name: "StripeConnectionError" });
    }
  };

  function planOn(s: FakeSubscription): string | null {
    return priceOf(s.priceId).planId ?? s.metadataPlanId;
  }

  /** What a move to this price and quantity would cost today: the unused part of the old plan is credited, the rest of the period is charged at the new one. */
  function proration(s: FakeSubscription, unitAmount: number, quantity: number, at: Date): number {
    const whole = s.periodEnd.getTime() - s.periodStart.getTime();
    const left = Math.max(0, Math.min(whole, s.periodEnd.getTime() - at.getTime()));
    const old = priceOf(s.priceId).unitAmount * s.quantity;
    return Math.round((unitAmount * quantity * left) / whole) - Math.round((old * left) / whole);
  }

  function stateOf(s: FakeSubscription): SubscriptionState {
    return {
      subscriptionId: s.id,
      customerId: s.customerId,
      status: s.status,
      itemId: s.itemId,
      quantity: s.quantity,
      planId: planOn(s),
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      cancelAt: s.cancelAt,
      pending: s.pending ? { planId: priceOf(s.pending.priceId).planId } : null,
      schedule: s.schedule ? { id: s.schedule.id, next: s.schedule.next ? { planId: s.schedule.next.planId, at: s.periodEnd } : null } : null,
      openInvoice: s.latestInvoice.status === "open" ? { id: s.latestInvoice.id, payUrl: `https://invoice.stripe.com/i/${s.latestInvoice.id}`, dueCents: s.latestInvoice.dueCents } : null,
    };
  }

  const gateway: PlanGateway = {
    async getState(subscriptionId) {
      outage("getState");
      const found = subscriptions.get(subscriptionId);
      return found ? stateOf(found) : null;
    },

    async ensurePrice({ planId, perSeatCents, interval }) {
      calls.ensurePrice += 1;
      outage("ensurePrice");
      const before = priceByPlan.get(planId);
      if (before) return before;
      const id = next("price");
      prices.set(id, { id, planId, unitAmount: perSeatCents, interval });
      priceByPlan.set(planId, id);
      return id;
    },

    async previewUpgrade({ state, perSeatCents, seats, at }) {
      calls.previewUpgrade += 1;
      outage("previewUpgrade");
      return { dueNowCents: proration(sub(state.subscriptionId), perSeatCents, seats, at) };
    },

    async applyUpgrade({ state, planId, priceId, seats, at }) {
      calls.applyUpgrade += 1;
      outage("applyUpgrade");
      const before = upgradeAnswers.get(planId);
      if (before) return { ...before };
      if (beforeChange) {
        const run = beforeChange;
        beforeChange = null;
        await run();
      }
      const s = sub(state.subscriptionId);
      if (s.itemId !== state.itemId) throw new Error("No subscription item with this ID on the subscription.");
      const dueCents = proration(s, priceOf(priceId).unitAmount, seats, at);
      const card = cards.get(s.customerId) ?? "good";
      const invoiceId = next("in");
      let answer: { applied: boolean };
      if (card === "good" || dueCents <= 0) {
        s.priceId = priceId;
        s.quantity = seats;
        s.pending = null;
        s.latestInvoice = { id: invoiceId, status: "paid", dueCents };
        answer = { applied: true };
      } else {
        s.pending = { priceId, quantity: seats, invoiceId };
        s.latestInvoice = { id: invoiceId, status: "open", dueCents };
        answer = { applied: false };
      }
      upgradeAnswers.set(planId, answer);
      return { ...answer };
    },

    async scheduleChange({ state, planId, priceId, seats, interval }) {
      calls.scheduleChange += 1;
      outage("scheduleChange");
      if (beforeChange) {
        const run = beforeChange;
        beforeChange = null;
        await run();
      }
      const s = sub(state.subscriptionId);
      s.schedule = { id: s.schedule?.id ?? next("sub_sched"), next: { priceId, quantity: seats, planId, interval } };
      return { at: s.periodEnd };
    },

    async releaseSchedule(scheduleId) {
      calls.releaseSchedule += 1;
      outage("releaseSchedule");
      for (const s of subscriptions.values()) if (s.schedule?.id === scheduleId) s.schedule = null;
    },

    async voidInvoice(invoiceId) {
      calls.voidInvoice += 1;
      outage("voidInvoice");
      for (const s of subscriptions.values()) {
        if (s.latestInvoice.id !== invoiceId || s.latestInvoice.status !== "open") continue;
        s.latestInvoice = { ...s.latestInvoice, status: "void" };
        if (s.pending?.invoiceId === invoiceId) s.pending = null;
      }
    },

    async createPortalSession({ customerId, returnUrl }) {
      calls.createPortalSession += 1;
      outage("createPortalSession");
      portalVisits.push({ customerId, returnUrl });
      return `https://billing.stripe.com/p/session/${next("bps")}`;
    },
  };

  /** What the billing rules are told when they ask where a subscription stands (lib/stripe.ts's snapshot, from the same made-up subscription). */
  const fetchSubscription = async (id: string): Promise<SubscriptionSnapshot | null> => {
    const s = subscriptions.get(id);
    if (!s) return null;
    return {
      subscriptionId: s.id,
      customerId: s.customerId,
      status: s.status,
      latestInvoicePaid: s.latestInvoice.status === "paid",
      currentPeriodEnd: s.periodEnd,
      cancelAt: s.cancelAt,
      planId: s.metadataPlanId,
      itemPlanId: priceOf(s.priceId).planId,
      pendingPlanId: s.pending ? priceOf(s.pending.priceId).planId : null,
      scheduledPlanId: s.schedule?.next?.planId ?? null,
      scheduledAt: s.schedule?.next ? s.periodEnd : null,
    };
  };

  return {
    gateway,
    fetchSubscription,
    calls,
    failNext,
    portalVisits,
    subscriptions,
    newCustomerId: () => next("cus"),

    /** A subscription as a first checkout leaves it: paid, on a price with no plan mark, the plan id on the subscription itself. */
    start(args: { customerId: string; planId: string; perSeatCents: number; seats: number; interval: Interval; periodStart: Date }) {
      const priceId = next("price");
      prices.set(priceId, { id: priceId, planId: null, unitAmount: args.perSeatCents, interval: args.interval });
      const id = next("sub");
      subscriptions.set(id, {
        id,
        customerId: args.customerId,
        status: "active",
        metadataPlanId: args.planId,
        itemId: next("si"),
        priceId,
        quantity: args.seats,
        periodStart: args.periodStart,
        periodEnd: new Date(args.periodStart.getTime() + periodLength(args.interval)),
        cancelAt: null,
        latestInvoice: { id: next("in"), status: "paid", dueCents: args.perSeatCents * args.seats },
        pending: null,
        schedule: null,
      });
      return id;
    },

    setCard(customerId: string, card: Card) {
      cards.set(customerId, card);
    },

    /** Run this once, in the middle of the next upgrade or schedule, before Stripe "does" it. */
    beforeNextChange(run: () => Promise<void>) {
      beforeChange = run;
    },

    /** The admin pays the unpaid invoice on Stripe's page (with a card that works, or by approving the charge). */
    payOpenInvoice(subscriptionId: string) {
      const s = sub(subscriptionId);
      if (s.latestInvoice.status !== "open") throw new Error("Nothing to pay.");
      s.latestInvoice = { ...s.latestInvoice, status: "paid" };
      if (s.pending) {
        s.priceId = s.pending.priceId;
        s.quantity = s.pending.quantity;
        s.pending = null;
      }
      if (s.status === "past_due") s.status = "active";
    },

    /** About a day passes with the upgrade's invoice unpaid: Stripe gives up on the change. */
    expirePending(subscriptionId: string) {
      const s = sub(subscriptionId);
      if (!s.pending) return;
      s.latestInvoice = { ...s.latestInvoice, status: "void" };
      s.pending = null;
    },

    /** The renewal date arrives: a scheduled change takes effect, and the new period is charged. */
    renew(subscriptionId: string) {
      const s = sub(subscriptionId);
      if (s.schedule?.next) {
        s.priceId = s.schedule.next.priceId;
        s.quantity = s.schedule.next.quantity;
        s.itemId = next("si"); // Stripe gives the line a new id when a schedule's phase changes it.
        s.schedule = { id: s.schedule.id, next: null }; // Spent, but still attached.
      }
      const price = priceOf(s.priceId);
      s.periodStart = s.periodEnd;
      s.periodEnd = new Date(s.periodStart.getTime() + periodLength(price.interval));
      const paid = (cards.get(s.customerId) ?? "good") === "good";
      s.latestInvoice = { id: next("in"), status: paid ? "paid" : "open", dueCents: price.unitAmount * s.quantity };
      s.status = paid ? "active" : "past_due";
    },

    /** The admin cancels on Stripe's billing page: the subscription ends at the end of the period. Refused while a schedule is attached, as Stripe refuses it. */
    cancelAtPeriodEnd(subscriptionId: string) {
      const s = sub(subscriptionId);
      if (s.schedule) throw new Error("The subscription is managed by a subscription schedule, and updating any cancelation behavior directly is not allowed.");
      s.cancelAt = s.periodEnd;
    },

    /** What Stripe was last asked to charge for one unit, and for how many, on this subscription. */
    onStripe(subscriptionId: string) {
      const s = sub(subscriptionId);
      const price = priceOf(s.priceId);
      return { unitAmount: price.unitAmount, interval: price.interval, quantity: s.quantity, planId: planOn(s), pending: Boolean(s.pending), scheduled: s.schedule?.next ?? null, hasSchedule: Boolean(s.schedule) };
    },
  };
}

export type FakePlanStripe = ReturnType<typeof fakePlanStripe>;
