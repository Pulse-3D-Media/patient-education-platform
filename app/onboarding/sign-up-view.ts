import { redirect } from "next/navigation";
import { getBillingView } from "@/app/admin/billing/billing";
import { getCheckoutView, type CheckoutOffer, type CheckoutView } from "@/app/admin/billing/checkout-view";
import { requireClinicPage, type CurrentClinic } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";

/**
 * Who may see the plan and payment steps of sign-up, decided on the server
 * for every request (rule 8). SERVER ONLY: it reads the database.
 *
 * The steps are offered ONLY where the Billing page would draw its plan
 * picker for this clinic right now: the same function decides both
 * (getCheckoutView in app/admin/billing/checkout-view.ts). So everything that
 * keeps checkout shut keeps these steps shut too, with nothing to keep in
 * step by hand:
 *
 *   - checkoutIsOpen() in lib/stripe.ts is false (the production deployment,
 *     a live key, BILLING_CHECKOUT not "test", the production database);
 *   - no pricing version is saved and active;
 *   - a first payment is already under way in Stripe;
 *   - the clinic is a hospital, managed by Pulse, or paused or ended by hand;
 *   - the clinic already pays.
 *
 * In every one of those cases the person is sent to /admin/billing, which is
 * exactly where a new clinic's owner went before these steps existed, and
 * which says plainly why there is no plan to choose (for example "Choosing a
 * plan here is not open yet"). Never a dead end, never a payment form.
 *
 * A member (not an office admin) goes to the library, which tells them to ask
 * their admin; a clinic that is already open goes to the library too. Someone
 * signed out is sent to sign in by requireClinicPage(), and back here after.
 */
export type SignUpPicker = {
  clinic: CurrentClinic;
  offer: Extract<CheckoutOffer, { kind: "picker" }>;
  view: CheckoutView;
};

export async function requireSignUpPicker(): Promise<SignUpPicker> {
  const clinic = await requireClinicPage();
  if (!clinic.isAdmin || clinicIsOpen(clinic)) redirect("/library");

  const billing = await getBillingView(clinic.id);
  const view = billing ? await getCheckoutView(clinic.id, billing.plan) : null;
  if (!view || view.offer.kind !== "picker") redirect("/admin/billing");
  return { clinic, offer: view.offer, view };
}
