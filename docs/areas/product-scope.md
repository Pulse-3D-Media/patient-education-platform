# Product scope and where the build stands

Moved out of the root `CLAUDE.md` in November 2026, word for word except where the pull request that moved it says otherwise.
A section name in quotes ("Billing state", "Roles") is a heading in one of the files under `docs/areas/`; the index at the end of the root `CLAUDE.md` says which.

## Where the build stands

**Phase 1 is done:** create a link, watch a video, link expires.
**We are in Phase 2, the clinic dashboard:** logins (done, see Auth), clinics and people (done, see Roles), the Pulse 3D master dashboard (done, see the four surfaces), the clinic admin area's sections (done: overview, shared links, people, billing), clinic branding (implemented, device acceptance pending), paused links a clinic can turn back on (done, see "How a link expires, pauses, and is turned back on"), calm error pages with a time limit on sign-in, error alerts and a health check (done, see "When something breaks"), billing (built in steps, below), and real video hosting (built: Mux signed playback, see "The video boundary"; an animation moves to Mux when Pulse staff upload its file from `/pulse/videos`, or paste the signed playback id of an asset made in the Mux dashboard; the Mux account, signing key, access token and webhook are Evan's to set up, and a video with neither a Mux id nor a CDN address cannot be published), reports for Pulse staff (built: `/pulse/reports`, totals only; clinics get no reports at all, see the four surfaces), and printed QR codes that do not run out (built, see "Printed QR codes"; the production migration is Evan's).
**Billing is being built in steps, in Stripe test mode only.**
Done: the payment-state foundation (what is stored about a clinic's subscription, the rule that turns it into access, and the webhook that keeps it true; see "Billing state").
Also done: self-serve checkout, where an eligible clinic's admin picks a plan on `/admin/billing` and pays on Stripe's own page (see "Self-serve checkout").
Also done: surgeon seats and the account owner (see "Surgeon seats").
Also done: changing a paid plan, and Stripe's own billing page for the card, invoices and cancelling (see "Plan changes and billing recovery").
Not built: tax, a founding discount, billing emails of our own.
**Nothing real is ever charged: the app refuses a live Stripe key, and test-mode checkout, plan changes and Stripe's billing page are never offered on the production deployment.**

## Phase 1 scope

**In scope:** the three original models (Video, Clinic, Share) · `app/library` to browse and play · `app/admin` to create and manage share links · `app/watch/[code]` for patients · QR code generation · link expiry.

**The landing page is built** (the bare address for a signed-out visitor, with Sign in and Set up a clinic in one box), and so are sign-up's steps, the welcome dialog, the four setup steps, the join screen and the quick tour; the reminder emails come after them.
**Still not built unless a task asks for it:** tax, a founding discount, pricing tiers by clinic size, analytics dashboards (beyond the aggregate Pulse reports), reports for clinics, any email but the two that exist (a paused link's request to the clinic, see "How a link expires, pauses, and is turned back on", and the error alert to Pulse, see "When something breaks"), file storage of our own (video files live in Mux, uploaded from `/pulse/videos` straight from the staff member's browser; see "The video boundary").
(The billing state, the Stripe webhook, self-serve checkout, surgeon seat limits, plan changes and Stripe's billing page exist; see "Billing state", "Surgeon seats" and "Plan changes and billing recovery".)

**Do not invent a login system.**
Sign-in is **Clerk** (see Auth), and its organizations feature is what models clinics and doctors.
Never add a users table, a password field or a session cookie of our own.

If a request seems to need something on the not-built list, say so before building it.

## Phase 2 scope

Phase 2 is the clinic dashboard: logins, clinics, doctors, permissions, real video hosting.
It also adds **`app/pulse`**, the Pulse 3D master dashboard (see the four surfaces above).

**Decided: self sign-up with card payment.**
Solo (1 surgeon) and Clinic (2 to 10 surgeons) sign themselves up and pay by card.
Enterprise (11 or more surgeons, or any hospital) is set up by Pulse from `app/pulse`.
**Decided by Evan on 2026-09-25: clinics are not asked whether they are a clinic or a hospital.**
The seat limit is what sends a big practice to Pulse (more seats than the active pricing version's Clinic maximum, 10 by default, is Enterprise, quoted with no amount and refused at checkout), and only Pulse staff can mark a clinic a hospital, on its `/pulse` page.
The trade-off, accepted: a small hospital with that many surgeons or fewer can pay by card without talking to Pulse first, unless Pulse staff have marked it a hospital.
The payment state underneath it and the checkout itself are built, in Stripe test mode (see "Billing state" and "Self-serve checkout").
Prices, founding terms, tax, refund and cancellation terms and the customer-facing wording about recurring charges are **not approved yet**; Evan and Van approve them before live payments, and nothing in the code should be read as having decided them.

**Built so far:** a person signs up on the landing page's "Set up a clinic" tab (name and work email, then the email code; see "The landing page and sign-up" in `docs/areas/auth-and-roles.md`), gets a clinic (a Clerk organization) with a provisional name from their own, becomes its account owner, and goes through the plan and payment steps (`/onboarding/plan`, `/onboarding/payment`, Stripe's hosted page in test mode, then the welcome dialog over the library once Stripe confirms the payment; see "Sign-up's plan and payment steps" in `docs/areas/billing.md`).
Where checkout is not open (production today), they land on `/admin/billing` on a PENDING clinic that shows "Choose a plan to start" until Pulse staff open it by hand on `/pulse` (or with `npm run db:set-status`), exactly as before.
Then, from the welcome dialog's "Finish setting up" or the library's "Finish setup", the clinic's office admins go through **setup** at `/onboarding/setup`: four skippable steps (the clinic's real name and phone, its logo and colour, the team, a test link), with where it stands saved on the clinic so anyone who leaves comes back to the same step, ending "You're ready for patients." (`lib/setup.ts`; clinics made before setup count as set up).
An invited person enters their own name and credential on the join screen when they accept (`/onboarding/join`; see "Surgeon seats").
The quick tour of the library (two stops, a third for office admins) starts from the welcome dialog, the end of setup or the account menu, and is offered once to someone who has just joined (see "The quick tour" in `docs/areas/library.md`).
Not built yet from the same design: the reminder emails, and Stripe's form inside our page.
Once it is open, admins invite people from `/admin/people` (each invitation holds a seat) and switch admin on or off for each person.
Pulse staff set each clinic's plan (categories and surgeon seats) on `/pulse` or with `npm run db:set-plan`.
The categories on the plan decide what the clinic's library shows and what it may share (see Category entitlements below), and the surgeon seats decide how many people may hold one (see Surgeon seats).
