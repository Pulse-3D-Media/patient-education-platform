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
 *
 * An address holding a tab or a line break anywhere is refused too. A
 * browser deletes those characters before it reads an address, so "/", a
 * tab, then "/evil.example" would be read as "//evil.example": another site.
 */
export function checkoutDestination(address: string): { kind: "here"; path: string } | { kind: "stripe"; url: string } | null {
  if (HAS_TAB_OR_LINE_BREAK.test(address)) return null;
  if (address.startsWith("/") && !address.startsWith("//") && !address.startsWith("/\\")) return { kind: "here", path: address };
  if (address.startsWith(STRIPE_CHECKOUT_PREFIX)) return { kind: "stripe", url: address };
  return null;
}

/** The characters a browser silently deletes from an address before reading it. */
const HAS_TAB_OR_LINE_BREAK = /[\t\n\r]/;

/**
 * Stripe's page for paying one invoice, or null. What the plan change form
 * checks before it draws "Pay on Stripe's page": the server already checks
 * the address, and this is the browser checking again, as its siblings do.
 */
export function stripeInvoicePage(address: string | null | undefined): string | null {
  if (!address || HAS_TAB_OR_LINE_BREAK.test(address)) return null;
  return address.startsWith(STRIPE_INVOICE_PREFIX) ? address : null;
}

/**
 * Stripe's browser script, for the card form on the sign-up payment step
 * (components/sign-up/CardForm.tsx). Loaded straight from Stripe, as Stripe
 * requires (it must never be copied into our own files), and only on that one
 * page, only once the server has said checkout is open there. The "dahlia" in
 * the address is the Stripe.js version that matches the API version the server
 * is pinned to (STRIPE_API_VERSION in lib/stripe.ts, 2026-08-26.dahlia); move
 * the two together.
 */
export const STRIPE_JS_URL = "https://js.stripe.com/dahlia/stripe.js";

/**
 * Is this a publishable key the card form may use? TEST keys only ("pk_test_"),
 * to match the server, which refuses any secret key that is not a test key
 * (isTestSecretKey in lib/stripe.ts). A publishable key is public by design (it
 * is in the page), so this is not about secrecy: it is so a live key pasted into
 * a setting by mistake can never draw a form that takes real cards.
 */
export function isTestPublishableKey(key: string | undefined | null): key is string {
  return typeof key === "string" && /^pk_test_[A-Za-z0-9]+$/.test(key);
}
