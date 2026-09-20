"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { errorCode } from "@/lib/billing-events";
import { checkPayment, startCheckout } from "@/lib/checkout";
import { readPlanSelection } from "@/lib/checkout-rules";
import { getBillingClinicId } from "@/lib/clinic";
import { getClinicPlan, setClinicPracticeType } from "@/lib/db/clinics";
import { getSignedInName } from "@/lib/people";
import { checkoutIsOpen, fetchSubscriptionSnapshot, stripeGateway } from "@/lib/stripe";
import { pickTrustedOrigin } from "@/lib/trusted-origin";

/**
 * What a clinic can do on its Billing page: say what kind of practice it is
 * (first in this file), and choose a plan and pay for it (further down).
 *
 * The practice question is asked once. A hospital or health system is always set up
 * by Pulse 3D and is never offered card checkout, so the answer has to be
 * on file before any checkout exists, and it is never guessed from a name.
 *
 * Who may answer, and for which clinic, is decided on the server:
 *
 *   - only an office admin, of their own clinic, found from the session by
 *     getBillingClinicId(). Unlike every other clinic action this one works
 *     for a clinic that is NOT open, because Billing is the page a closed
 *     clinic comes to. The form carries no clinic id, and one added to it
 *     is never read.
 *   - only while the answer is still "not answered". Afterwards only Pulse
 *     staff can change it (on /pulse), so a hospital that has been told it
 *     is Enterprise cannot simply answer again.
 */

export type PracticeFormState = { ok?: string; error?: string } | null;

const ANSWERS = { CLINIC: "CLINIC", HOSPITAL: "HOSPITAL" } as const;

export async function answerPracticeTypeAction(_previous: PracticeFormState, formData: FormData): Promise<PracticeFormState> {
  const clinicId = await getBillingClinicId();
  if (!clinicId) return { error: "Only your clinic's office admins can answer this." };

  const value = String(formData.get("practiceType") ?? "");
  if (!Object.hasOwn(ANSWERS, value)) return { error: "Choose one of the two." };
  const answer = ANSWERS[value as keyof typeof ANSWERS];

  try {
    const plan = await getClinicPlan(clinicId);
    if (!plan) return { error: "Your clinic could not be found. Try again in a moment." };
    if (plan.practiceType !== "UNKNOWN") {
      return { error: "This has already been answered. To change it, get in touch with Pulse 3D." };
    }
    const name = (await getSignedInName()) ?? "A clinic admin";
    const { logged } = await setClinicPracticeType(clinicId, answer, `${name} (clinic admin)`, { onlyIfUnknown: true });
    // Someone else in the clinic answered in the same moment: theirs stands.
    if (!logged) return { error: "This has already been answered. To change it, get in touch with Pulse 3D." };
  } catch (error) {
    console.error("Saving a clinic's practice type failed", error);
    return { error: "That did not save. Nothing was changed. Try again in a moment." };
  }

  revalidatePath("/admin/billing");
  return { ok: "Saved. Thank you." };
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * "Continue to payment" on the plan picker.
 *
 * What the form may say is what was picked (categories, seats, month or
 * year) and which total the admin was looking at. That is all that is read
 * (readPlanSelection). A clinic id, an amount, a price, a discount or a
 * founding flag added to the request is never looked at: the clinic is the
 * signed-in admin's own, and the price is worked out on the server
 * (startCheckout in lib/checkout.ts).
 *
 * Like the practice question, this works for a clinic that is NOT open,
 * because paying is how a closed clinic opens.
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
