import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { ignoreBillingEvent, markBillingEventFailed, receiveBillingEvent } from "./billing";
import { prisma } from "./client";

/**
 * The two writers that close a Stripe notification from outside the
 * reconcile transaction. Both must leave a notification alone once another
 * attempt has finished it, so a slow first attempt cannot relabel what a
 * retry already did.
 *
 * Every event id is made up. Every row made here is deleted afterwards.
 */

const tag = randomBytes(5).toString("hex");
const eventIds: string[] = [];
let serial = 0;

async function makeEvent() {
  const stripeEventId = `evt_vitestclose${tag}${(serial += 1)}`;
  eventIds.push(stripeEventId);
  const { row } = await receiveBillingEvent({ stripeEventId, type: "customer.subscription.updated", stripeCustomerId: null, stripeSubscriptionId: null });
  return row.id;
}

const read = (id: string) =>
  prisma.billingEvent.findUniqueOrThrow({ where: { id }, select: { status: true, outcome: true, lastErrorCode: true, processedAt: true } });

afterAll(async () => {
  await prisma.billingEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
  await prisma.$disconnect();
});

describe("ignoreBillingEvent", () => {
  it("closes a notification that is still being worked on, or that failed before", async () => {
    const received = await makeEvent();
    await ignoreBillingEvent(received, "Nothing to do.");
    expect(await read(received)).toMatchObject({ status: "IGNORED", outcome: "Nothing to do.", lastErrorCode: null });

    const failed = await makeEvent();
    await markBillingEventFailed(failed, "TimeoutError");
    await ignoreBillingEvent(failed, "Nothing to do after all.");
    expect(await read(failed)).toMatchObject({ status: "IGNORED", outcome: "Nothing to do after all.", lastErrorCode: null });
  });

  it("leaves a notification another attempt already PROCESSED exactly as it was", async () => {
    const id = await makeEvent();
    const processedAt = new Date("2026-01-02T03:04:05Z");
    await prisma.billingEvent.update({ where: { id }, data: { status: "PROCESSED", outcome: "Plan started.", processedAt } });

    await ignoreBillingEvent(id, "No clinic has this Stripe customer. Nothing was changed.");

    expect(await read(id)).toEqual({ status: "PROCESSED", outcome: "Plan started.", lastErrorCode: null, processedAt });
  });

  it("leaves a notification already IGNORED with its first outcome", async () => {
    const id = await makeEvent();
    await ignoreBillingEvent(id, "First reason.");
    await ignoreBillingEvent(id, "Second reason.");
    expect(await read(id)).toMatchObject({ status: "IGNORED", outcome: "First reason." });
  });
});

describe("markBillingEventFailed (its sibling, for comparison)", () => {
  it("leaves a finished notification alone", async () => {
    const id = await makeEvent();
    await ignoreBillingEvent(id, "Nothing to do.");
    await markBillingEventFailed(id, "TimeoutError");
    expect(await read(id)).toMatchObject({ status: "IGNORED", lastErrorCode: null });
  });
});
