/**
 * Where Stripe's own hosted pages live. Pure and safe for the browser.
 *
 * An address this app sends a person to for paying an invoice or managing
 * billing must start with one of these. The server checks before handing
 * one out, and the browser checks again before going there, so a wrong
 * value can never send someone to a page that is not Stripe's.
 */

/** Stripe's page for paying one invoice. */
export const STRIPE_INVOICE_PREFIX = "https://invoice.stripe.com/";

/** Stripe's billing page: card, invoices, cancelling. */
export const STRIPE_PORTAL_PREFIX = "https://billing.stripe.com/";

/** Stripe's payment page for a first plan (Stripe Checkout). */
export const STRIPE_CHECKOUT_PREFIX = "https://checkout.stripe.com/";

/**
 * Where the plan picker may send the browser after the server answers.
 * Either one of our own pages (a path with a single leading "/", such as
 * the return page; never "//", which a browser reads as another site), or
 * Stripe's payment page. Anything else is null and the browser stays put:
 * the server already checks the address, and this is the browser checking
 * again, as BillingButtons.tsx does for Stripe's other two pages.
 */
export function checkoutDestination(address: string): { kind: "here"; path: string } | { kind: "stripe"; url: string } | null {
  if (address.startsWith("/") && !address.startsWith("//") && !address.startsWith("/\\")) return { kind: "here", path: address };
  if (address.startsWith(STRIPE_CHECKOUT_PREFIX)) return { kind: "stripe", url: address };
  return null;
}
