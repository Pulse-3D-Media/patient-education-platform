"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { errorKind } from "@/lib/error-kind";
import { checkPayment, startCheckout } from "@/lib/checkout";
import { readPlanSelection } from "@/lib/checkout-rules";
import { getBillingClinicId } from "@/lib/clinic";
import { getSignedInName } from "@/lib/people";
import { readChangeConfirm, readChangeRequest } from "@/lib/plan-change";
import {
  cancelWaitingChange,
  confirmPlanChange,
  findInvoiceToPay,
  openBillingPortal,
  reviewPlanChange,
  type ChangeSummary,
  type PlanChangeDeps,
} from "@/lib/plan-changes";
import { checkoutIsOpen, fetchSubscriptionSnapshot, stripeGateway, stripePlanGateway } from "@/lib/stripe";
import { pickTrustedOrigin } from "@/lib/trusted-origin";

/**
 * What a clinic can do on its Billing page: choose a plan and pay for it,
 * check on a payment, and, once it is paying, change the plan, cancel a
 * change, and open Stripe's billing page. Any office admin may do all of it,
 * the account owner included (decided by Evan on 2026-10-05). All of it works for a clinic that is NOT open,
 * because Billing is the page a closed clinic comes to, and all of it finds
 * the clinic from the session, never from the form.
 *
 * There is no longer a "clinic or hospital?" question here. Only Pulse
 * staff mark a clinic a hospital, on its /pulse page, and a form field
 * named practiceType is never read by anything in this file.
 */

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * "Continue to payment" on the plan picker.
 *
 * What the form may say is what was picked (categories, seats, month or
 * year) and which total the admin was looking at. That is all that is read
 * (readPlanSelection). A clinic id, an amount, a price, a discount, a
 * founding flag or a practice type added to the request is never looked
 * at: the clinic is the signed-in admin's own, and the price is worked out
 * on the server (startCheckout in lib/checkout.ts).
 *
 * This works for a clinic that is NOT open, because paying is how a closed
 * clinic opens.
 *
 * What comes back:
 *   redirectTo   the address of Stripe's payment page; the browser goes there
 *   changed      the total differs from the one on screen; nothing was made
 *   error        a plain sentence; nothing was made, and the picks stay as they are
 */
export type CheckoutFormState = { redirectTo?: string; changed?: string; error?: string } | null;

export async function startCheckoutAction(_previous: CheckoutFormState, formData: FormData): Promise<CheckoutFormState> {
  const clinicId = await getBillingClinicId();
  if (!clinicId) return { error: "Only your clinic's office admins can choose a plan." };

  const read = readPlanSelection(formData);
  if (!read.ok) return { error: read.error };

  try {
    const origin = pickTrustedOrigin((await headers()).get("host"), process.env);
    if (!origin) return { error: "Checkout cannot be started from this address. Get in touch with Pulse 3D." };

    const { userId } = await auth();
    const name = (await getSignedInName()) ?? "A clinic admin";
    const result = await startCheckout({
      clinicId,
      selection: read.selection,
      actor: { id: userId ?? "unknown", name },
      origin,
      deps: { gateway: stripeGateway, isOpen: checkoutIsOpen() },
    });

    if (result.kind === "redirect") return { redirectTo: result.url };
    if (result.kind === "confirming") return { redirectTo: "/admin/billing/return" };
    if (result.kind === "changed") {
      revalidatePath("/admin/billing");
      return { changed: result.message };
    }
    return { error: result.message };
  } catch (error) {
    // The kind of failure only: a Stripe or database message can carry an id.
    console.error(`Starting checkout failed: ${errorKind(error)}`);
    return { error: "Checkout could not be started just now. Nothing was charged. Try again in a moment." };
  }
}

/**
 * "Check again" on the return page: ask Stripe where the clinic's payment
 * stands instead of waiting to be told (checkPayment in lib/checkout.ts).
 * It cannot open anything by itself; it runs the same rules the webhook
 * runs, on what Stripe says. Safe to press any number of times.
 */
export type CheckPaymentState = { message?: string; error?: string } | null;

export async function checkPaymentAction(): Promise<CheckPaymentState> {
  const clinicId = await getBillingClinicId();
  if (!clinicId) return { error: "Only your clinic's office admins can do this." };

  try {
    const result = await checkPayment({ clinicId, gateway: stripeGateway, fetchSubscription: fetchSubscriptionSnapshot });
    revalidatePath("/admin/billing");
    revalidatePath("/admin/billing/return");
    return { message: result.message };
  } catch (error) {
    console.error(`Checking a payment failed: ${errorKind(error)}`);
    return { error: "We could not reach Stripe just now. Nothing has changed. Try again in a moment." };
  }
}

// ---------------------------------------------------------------------------
// Changing a plan that is being paid for, and Stripe's own billing page
// ---------------------------------------------------------------------------

/**
 * Everything below is for the clinic's OFFICE ADMINS (the account owner is
 * one). Each action starts with getBillingClinicId(), which is null for
 * anyone else. The clinic is the admin's own, found from the session; a
 * clinic id, a Stripe customer id, an amount or a price in a form is never read.
 */
const ADMINS_ONLY = "Only your clinic's office admins can change billing.";

function planDeps(): PlanChangeDeps {
  return { gateway: stripePlanGateway, fetchSubscription: fetchSubscriptionSnapshot, isOpen: checkoutIsOpen() };
}

/** What the review step shows. Plain values only, so it can cross to the browser. */
export type ChangeReview = {
  summary: ChangeSummary;
  /** Starts now: what Stripe will charge today, and the moment (in whole seconds) that amount is for. */
  now: { dueNowCents: number; atSeconds: number; renewsAt: Date | null } | null;
  /** Starts at the next renewal. */
  renewal: { at: Date | null; words: string; replaces: boolean } | null;
};

export type ReviewState = { review?: ChangeReview; message?: string; error?: string } | null;

/**
 * "Review change": work out what the picked plan would do and cost. Changes
 * nothing, in the database or at Stripe.
 */
export async function reviewPlanChangeAction(formData: FormData): Promise<ReviewState> {
  const clinicId = await getBillingClinicId();
  if (!clinicId) return { error: ADMINS_ONLY };

  const read = readChangeRequest(formData);
  if (!read.ok) return { error: read.error };

  try {
    const result = await reviewPlanChange({ clinicId, request: read.request, deps: planDeps() });
    if (result.kind === "review") {
      return {
        review: {
          summary: result.summary,
          now: result.now ? { dueNowCents: result.now.dueNowCents, atSeconds: Math.floor(result.now.at.getTime() / 1000), renewsAt: result.now.renewsAt } : null,
          renewal: result.renewal ? { at: result.renewal.at, words: result.renewal.words, replaces: result.renewal.replaces } : null,
        },
      };
    }
    if (result.kind === "same") return { message: result.message };
    if (result.kind === "stale") revalidatePath("/admin/billing");
    return { error: result.message };
  } catch (error) {
    console.error(`Reviewing a plan change failed: ${errorKind(error)}`);
    return { error: "We could not work that out just now. Nothing has changed. Try again in a moment." };
  }
}

export type ConfirmState = { done?: string; payUrl?: string | null; unpaid?: string; stale?: string; error?: string } | null;

/**
 * "Confirm": make the change that was reviewed. The form sends the picks
 * again and what was on the review step; the server works everything out
 * again and compares (confirmPlanChange in lib/plan-changes.ts).
 */
export async function confirmPlanChangeAction(formData: FormData): Promise<ConfirmState> {
  const clinicId = await getBillingClinicId();
  if (!clinicId) return { error: ADMINS_ONLY };

  const read = readChangeConfirm(formData);
  if (!read.ok) return { stale: read.error };

  try {
    const { userId } = await auth();
    const name = (await getSignedInName()) ?? "A clinic admin";
    const result = await confirmPlanChange({ clinicId, request: read.request, seen: read.seen, actor: { id: userId ?? "unknown", name }, deps: planDeps() });
    revalidatePath("/admin/billing");
    if (result.kind === "changed" || result.kind === "scheduled") return { done: result.message };
    if (result.kind === "payment-needed") return { unpaid: result.message, payUrl: result.payUrl };
    if (result.kind === "stale") return { stale: result.message };
    return { error: result.message };
  } catch (error) {
    console.error(`Changing a plan failed: ${errorKind(error)}`);
    revalidatePath("/admin/billing");
    // Stripe may or may not have been reached, so this does not say "nothing was charged".
    return { error: "We could not confirm that change just now. Press Check with Stripe below to see where your plan stands before trying again." };
  }
}

export type BillingActionState = { message?: string; error?: string; redirectTo?: string } | null;

/** Cancel the change scheduled for the next renewal, or the upgrade waiting for its payment. The plan in force is not touched. */
export async function cancelWaitingChangeAction(which: "scheduled" | "payment"): Promise<BillingActionState> {
  const clinicId = await getBillingClinicId();
  if (!clinicId) return { error: ADMINS_ONLY };
  if (which !== "scheduled" && which !== "payment") return { error: "That could not be done." };

  try {
    const result = await cancelWaitingChange({ clinicId, which, deps: planDeps() });
    revalidatePath("/admin/billing");
    return result.ok ? { message: result.message } : { error: result.message };
  } catch (error) {
    console.error(`Cancelling a waiting plan change failed: ${errorKind(error)}`);
    revalidatePath("/admin/billing");
    return { error: "We could not reach Stripe just now. Press Check with Stripe below to see where your plan stands, then try again." };
  }
}

/**
 * "Check with Stripe" on the Billing page: the same look at Stripe as Check
 * again on the return page (checkPayment), worded for a clinic that is
 * already paying. Any office admin may press it: it changes nothing by
 * itself, it only brings the page into line with what Stripe says.
 */
export async function checkWithStripeAction(): Promise<BillingActionState> {
  const clinicId = await getBillingClinicId();
  if (!clinicId) return { error: "Only your clinic's office admins can do this." };

  try {
    await checkPayment({ clinicId, gateway: stripeGateway, fetchSubscription: fetchSubscriptionSnapshot });
    revalidatePath("/admin/billing");
    return { message: "Checked with Stripe. This page shows where things stand now." };
  } catch (error) {
    console.error(`Checking with Stripe failed: ${errorKind(error)}`);
    return { error: "We could not reach Stripe just now. Nothing has changed. Try again in a moment." };
  }
}

/** Open Stripe's own billing page for the admin's clinic: card, invoices, cancelling. Works for a clinic that is not open. */
export async function openBillingPortalAction(): Promise<BillingActionState> {
  const clinicId = await getBillingClinicId();
  if (!clinicId) return { error: ADMINS_ONLY };

  try {
    const origin = pickTrustedOrigin((await headers()).get("host"), process.env);
    if (!origin) return { error: "Stripe's billing page cannot be opened from this address. Get in touch with Pulse 3D." };
    const result = await openBillingPortal({ clinicId, origin, deps: planDeps() });
    return result.ok ? { redirectTo: result.url } : { error: result.message };
  } catch (error) {
    console.error(`Opening Stripe's billing page failed: ${errorKind(error)}`);
    return { error: "We could not reach Stripe just now. Try again in a moment." };
  }
}

/** Go to Stripe's page for the clinic's unpaid invoice: a renewal that failed, or an upgrade waiting for its payment. */
export async function payInvoiceAction(): Promise<BillingActionState> {
  const clinicId = await getBillingClinicId();
  if (!clinicId) return { error: ADMINS_ONLY };

  try {
    const result = await findInvoiceToPay({ clinicId, deps: planDeps() });
    return result.ok ? { redirectTo: result.url } : { error: result.message };
  } catch (error) {
    console.error(`Finding the invoice to pay failed: ${errorKind(error)}`);
    return { error: "We could not reach Stripe just now. Try again in a moment." };
  }
}
