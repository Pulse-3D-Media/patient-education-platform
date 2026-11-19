import { getCheckoutFacts } from "@/lib/db/billing";
import { errorKind } from "@/lib/error-kind";
import { readBillingRecord, type BillingRecord } from "@/lib/stripe";

/**
 * The payment method and billing history on /admin/billing, read from Stripe
 * (test mode) through lib/stripe.ts, the only file that talks to Stripe.
 *
 *   - "none": nothing to show and nothing to ask. Only where Stripe's own
 *     billing page may be opened for this clinic (`portal`, worked out by
 *     getCheckoutView: never on the production deployment, never for a
 *     clinic Pulse manages, never before a first payment was confirmed), and
 *     only for a clinic with a Stripe customer on its own record.
 *   - "ok": the card (or the kind of method) and the newest few invoices.
 *   - "unreachable": Stripe did not answer, or is not set up. The page says
 *     so calmly; the rest of the page does not depend on it.
 *
 * The customer and subscription ids come from the clinic's own billing
 * record, never from the request. Only the kind of a failure is logged.
 */
export type BillingHistoryView = { kind: "none" } | { kind: "ok"; record: BillingRecord } | { kind: "unreachable" };

export async function getBillingHistory(clinicId: string, portal: boolean): Promise<BillingHistoryView> {
  if (!portal) return { kind: "none" };
  const clinic = await getCheckoutFacts(clinicId);
  const customerId = clinic?.facts.stripeCustomerId ?? null;
  if (!clinic || !customerId) return { kind: "none" };
  try {
    return { kind: "ok", record: await readBillingRecord({ customerId, subscriptionId: clinic.facts.stripeSubscriptionId ?? null }) };
  } catch (error) {
    console.error("Billing: the payment method and history could not be read from Stripe", errorKind(error));
    return { kind: "unreachable" };
  }
}
