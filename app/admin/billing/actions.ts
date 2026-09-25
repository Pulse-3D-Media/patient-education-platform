"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { errorCode } from "@/lib/billing-events";
import { checkPayment, startCheckout } from "@/lib/checkout";
import { readPlanSelection } from "@/lib/checkout-rules";
import { getBillingClinicId } from "@/lib/clinic";
import { getSignedInName } from "@/lib/people";
import { checkoutIsOpen, fetchSubscriptionSnapshot, stripeGateway } from "@/lib/stripe";
import { pickTrustedOrigin } from "@/lib/trusted-origin";

/**
 * What a clinic can do on its Billing page: choose a plan and pay for it,
 * and check on a payment. Both work for a clinic that is NOT open, because
 * Billing is the page a closed clinic comes to; both find the clinic from
 * the session (getBillingClinicId), never from the form.
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
    console.error(`Starting checkout failed: ${errorCode(error)}`);
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
    console.error(`Checking a payment failed: ${errorCode(error)}`);
    return { error: "We could not reach Stripe just now. Nothing has changed. Try again in a moment." };
  }
}
