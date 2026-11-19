# app/admin/billing: billing for the clinic

Read `docs/areas/billing.md` and `docs/areas/pricing.md` before editing anything in this folder.

- **Stripe test mode only.**
  `lib/stripe.ts` is the only file that talks to Stripe and refuses a live key; checkout and plan changes are never offered on the production deployment.
- **Reachable by an admin of a closed clinic:** this page checks `isAdmin`, deliberately not `clinicIsOpen()`. Its actions use `getBillingClinicId()`, which nothing outside `app/admin/billing` may use (Remove on People has its own named lookup).
- **The server prices everything** (rule 8).
  Nothing the browser sends about money is believed; a total that differs from what was on screen creates nothing.
- **Payment is never inferred** from a redirect or the return page.
  Only Stripe saying an invoice is paid opens a clinic or applies a change.
- **The only place plan or price information appears on the clinic side.**
