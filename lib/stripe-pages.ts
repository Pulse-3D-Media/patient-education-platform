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
