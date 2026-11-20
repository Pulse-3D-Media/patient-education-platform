# Billing: state, self-serve checkout, plan changes

Moved out of the root `CLAUDE.md` in November 2026, word for word except where the pull request that moved it says otherwise.
A section name in quotes ("Billing state", "Roles") is a heading in one of the files under `docs/areas/`; the index at the end of the root `CLAUDE.md` says which.

## Billing state

Stripe, in **test mode only**.
`lib/stripe.ts` is the only file that talks to Stripe and it refuses any key that does not start with `sk_test_` or `rk_test_`; a live-mode notification is refused too.
Going live is a deliberate, reviewed change to that file, never a value pasted into Vercel.
This section is the state underneath checkout; "Self-serve checkout", after it, is how a clinic gets a subscription in the first place.

**Two things are kept apart.**
The **financial record** (`ClinicBilling`) is what Stripe says about the clinic's one expected subscription; it is brought up to date from Stripe whatever else is true, so it can always be checked against Stripe.
**Access** (`Clinic.status`, `Clinic.graceEndsAt`) is worked out by `effectiveAccess()` in `lib/billing-state.ts` from three inputs.
The state table, first rule that fits wins:

| Staff set by hand | Managed by Pulse | Billing | Status | Open? |
|---|---|---|---|---|
| PAUSED | any | any | PAUSED | no |
| CANCELED | any | any | CANCELED | no |
| OPEN | any | any | ACTIVE | yes |
| nothing | yes | any | PENDING | no |
| nothing | no | NONE or INCOMPLETE | PENDING | no |
| nothing | no | ACTIVE (also: cancellation scheduled) | ACTIVE | yes |
| nothing | no | PAST_DUE | PAST_DUE | until `graceEndsAt` |
| nothing | no | CANCELED | CANCELED | no |

- **What staff set by hand always wins.**
  No notification, old or new, reopens a clinic staff paused; billing never writes `staffAccess` to PAUSED, CANCELED or OPEN.
  Who, why and when are stored with it, and removing it ("Follow billing") hands the clinic back to its billing record.
  **One automatic change exists (decided while building, flagged for Evan):** when a self-serve clinic's first card payment is confirmed, a hand setting of OPEN is cleared, with a log entry, so a clinic opened by hand before billing follows its payments from then on.
  PAUSED and CANCELED are never cleared by anything but staff.
- **A Pulse-managed clinic keeps the plan and access staff gave it.**
  Billing news still updates its financial record and is still logged, but changes neither.
  Turning managed ON for a clinic that is open keeps it open (it is given OPEN in the same write).
- **Pausing, cancelling or marking a clinic managed does NOT cancel anything in Stripe.**
  A card subscription keeps charging until it is cancelled in Stripe, and every screen, script and log line that does one of those says so.
  Never describe hiding billing as stopping charges.
- **The webhook never applies what a notification says.**
  `POST /api/webhooks/stripe` first refuses a body whose Content-Length says it is over 1 MiB (413) or is not a number (400), before reading a byte of it (`judgeContentLength()` and `MAX_STRIPE_WEBHOOK_BYTES` in `lib/body-size.ts`; real notifications are a few kilobytes).
  It then checks the signature over the raw body, then `handleStripeEvent()` (`lib/billing-events.ts`) writes the notification down under Stripe's event id (insert first, catch the unique refusal: a repeat finds the row and, if it is finished, nothing at all is done), takes only the customer id and subscription id from its body, finds the clinic by the customer, and calls `reconcileSubscription()` (`lib/db/billing.ts`).
  That takes the clinic's billing **sync lock** (a named lock, `lib/db/billing-locks.ts`), asks Stripe where the subscription stands **now** while holding **no row lock**, then locks the clinic's row (the same lock every staff change takes), checks the record still expects the same subscription and customer it did when Stripe was asked (if not, nothing is written from that answer and Stripe is asked again, at most three times, then the attempt fails and is retried like any failure), and applies the answer with `decideBilling()`, writing the record, the plan, the status, one log entry and the notification's "finished" mark in **one transaction**.
  So order, lateness and repeats do not matter, two looks at Stripe for one clinic happen one after the other (an older answer is never written over a newer one), a notification and a staff pause happen one after the other, and "finished" is never true of work that did not commit.
  Event time and arrival order are never used to decide freshness.
- **What waits on what (audit finding E1, 2026-11-16).**
  No database row lock is ever held while Stripe is being asked something.
  Before, billing asked Stripe holding the clinic's row lock, which a surgeon's Send (`createShare()`) and a printed code's Play (`issueShareFromQrCode()`) take a share of, so a slow Stripe could make links fail for that clinic.
  Now: the **sync lock** is held for one whole look at Stripe and only another look at the same clinic (a notification, Check with Stripe, the staff reset) waits for it; the **plan change lock** is held while a plan change, or cancelling one, talks to Stripe, and only another plan change at the same clinic waits for it; the **clinic's row lock** is taken by billing only for its write, after Stripe has answered, so a link waits at most for that write.
  `lib/db/billing.slow-stripe.race.test.ts` holds Stripe slow and makes a link for the same clinic meanwhile, with a control that holds the row lock across the call (the old way) and shows the link waiting.
- **The Stripe API version is pinned** (`STRIPE_API_VERSION` in `lib/stripe.ts`, audit finding E6): the version the installed `stripe` package was built for, `2026-08-26.dahlia` with stripe 22.6.2.
  What Stripe does with a request follows the version, and two settings here must stay (see "Plan changes and billing recovery"), so a package update must not move it quietly.
  `lib/stripe.test.ts` fails if the pin is removed, and when the package is updated to one built for another version: then the version is changed on purpose and the plan-change checks against Stripe test mode are run again.
- **A subscription Stripe no longer has** (deleted, Stripe's test data cleared, or a key that cannot see it: **at go-live, every clinic that paid in test mode**, because a live key cannot see a single test-mode object) is its own outcome, never a frozen record (audit finding E3).
  When it is the subscription the clinic expects, `decideGone()` (`lib/billing-state.ts`) reads a live one as ended (CANCELED, closed by the state table) and a first payment that never finished as never started (NONE), with one log entry, and the notification is flagged "Needs a look"; the Stripe ids stay on the record as history.
  Closing a paying clinic this way is deliberate (Evan, 2026-11-18).
  **When it ends a clinic that was ACTIVE or PAST_DUE, Pulse staff get one email** (`lib/billing-gone-alert.ts`, through `lib/email.ts` to `ERROR_ALERT_EMAIL`, like the other Pulse alerts): the clinic's name, its new status, a link to its `/pulse` page built from the trusted origin, and what to do if it was a mistake (Reset billing, then the clinic buys again); no payment detail and no Stripe ids.
  A first payment that never finished ends with no email.
  Whether to send is decided in the same transaction as the change, under the sync lock (`goneClosure` on the result), so a notification and Check with Stripe that overlap send one email between them, and a repeat sends none; the send starts after the commit, handed to `after()`, under an idempotency key, and a failed send never fails or undoes the change (one log line, words and `errorKind()` only).
  Every caller outside `lib/db` goes through `reconcileAndTellPulse()` for this.
  The error alerts' ceiling does not apply: this is one email per closure, bounded by the number of clinics.
  **Switching the Stripe key to another account, including test mode to live at go-live, closes every clinic whose subscription the new key cannot see, at its next look at Stripe, with one email each.**
  A missing subscription that is not the expected one changes nothing, as before.
  Check again and checkout ask about the subscription on record even when Stripe no longer lists it, and a customer Stripe no longer has reads as having no subscriptions.
  **Reset billing**, on the clinic's `/pulse` page under Card billing (`resetBillingAction`, `requirePulseStaff()` first, a tick box saying Stripe was checked), then clears the Stripe ids, the waiting and scheduled plans and the dates, so the clinic's admin can choose a plan again with a new customer: under the sync lock it asks Stripe (`checkStripeIds()`) and is **refused while the recorded subscription, or any subscription on the recorded customer, is still alive** (a first payment under way included), **or while the customer has a Stripe payment page open**; under the row lock it is also **refused while a checkout attempt made within the hour** (the payment page's lifetime, plus five minutes) is on record, even if Stripe listed no open page a moment before.
  Clearing the customer then would strand a payment: Stripe's notification would name a customer no clinic has any more, and be ignored, so the clinic would have paid with no access; under the row lock it writes the record (CANCELED for a clinic that was ever paid for, NONE otherwise), the access the state table gives, and one log entry under the staff member's name, in one transaction.
  It changes nothing in Stripe and charges or refunds nothing.
- **Whose subscription it is.**
  The subscription Stripe returns must belong to the clinic's own Stripe customer (set once, by `setStripeCustomer()`, before checkout creates anything).
  Only the expected subscription is applied.
  A different one may take over only when the expected one is over or never started, it carries the id of the plan the clinic accepted and is waiting on (`metadata.billingPlanId` on the **subscription itself**, which checkout must put there: session metadata does not appear on subscription events), and it is not already dead.
  News of an old cancelled subscription therefore cannot touch its replacement.
  A second live subscription changes nothing and is flagged for a person ("Needs a look").
  So is any subscription on the clinic's own customer that is being **charged** and is not the plan the clinic accepted last (an earlier attempt's page paid after a newer one was started): nothing is changed, because what it bought cannot be known from here, but a person has to look.
  An unrecognised subscription nobody is paying for is noise and is not flagged.
  **A never-paid subscription that dies (it expired, or was cancelled before paying) clears the waiting plan only when it carried that very plan**: if the admin has started again since, the newer plan stays waiting, or the new checkout would be paid and then not recognised.
- **Payment is never inferred.**
  Not from a redirect, not from checkout completing, not from Stripe's word "active" alone: the first activation, and a recovery from PAST_DUE, both need the subscription's latest invoice to be **paid** (Stripe also says "active" when an invoice is written off).
  A first activation needs a paid invoice on every path (`addPaidEvidence()` in `lib/stripe.ts`).
  A clinic that was live and fails a renewal gets its grace period.
  A failed **first** payment leaves the subscription INCOMPLETE: no grace, no access.
  No trial and no second payment method exists; a trialing or paused subscription changes nothing and is flagged.
- **Grace.**
  Starts once, at the server's time when the failed renewal is first recorded (a late notification can only give a clinic more time, never less).
  The deadline is that moment plus the grace days setting as it was then (1 to 365; `graceDeadline()`), fixed: repeated failures never move it.
  It is cleared by a confirmed recovery.
  At the deadline itself the clinic is closed; no job has to run, because `clinicIsOpen()` compares the stored deadline with the server's clock on every request.
  A setting or a deadline that cannot be read means **no** grace, never unlimited.
- **A failure is retried, never lost.**
  When the work throws, everything rolls back, the notification is marked FAILED with the kind of error only, and the route answers 500 so Stripe sends it again.
  Staff can also press Try again on `/pulse/billing`.
  The work is awaited before answering: nothing runs in the background after the response.
- **Accepted plans are immutable.**
  `acceptPlanForCheckout()` (checkout's writer; `recordAcceptedPlan()` is the plain one) writes a `BillingPlan` row (amounts from the pricing engine on the server, checked again here) and points `pendingPlanId` at it.
  **A first confirmed payment starts the plan the paid subscription was bought for** (the plan id on the subscription's own metadata, which `reconcileSubscription()` accepts only when it is one of this clinic's own accepted plans), never whichever plan the record happens to be waiting on, and for a self-serve clinic copies its entitled categories, seats and pricing version onto the clinic.
  A paid subscription not marked with one of the clinic's plans starts nothing and is flagged "Needs a look" (found by the security audit of 2026-10-08: a second checkout started while the first payment was still unconfirmed, followed by the first being paid, used to grant the second, bigger plan while Stripe charged for the first).
  It is refused while a subscription is live, and while a first payment is still under way (INCOMPLETE; see "Self-serve checkout"): a paid plan is changed, not replaced (see "Plan changes and billing recovery", whose writer is `acceptPlanForChange()`). It is also refused with fewer seats than are taken right now, by people and open invitations (see "Surgeon seats").
- **Who may pay by card** is `selfServeEligibility()`: a clinic that is not a hospital, is not managed by Pulse, and has not been paused or ended by Pulse staff by hand (what staff set wins over billing, so its payment would be taken and it would stay closed; it talks to Pulse first).
  UNKNOWN, where every clinic starts, counts as a clinic.
  **Decided by Evan on 2026-09-25**, after the Prompt 3 preview test: the "clinic or hospital?" question was dropped from `/admin/billing`, because the seat limit already sends big practices to Pulse.
  The trade-off, accepted: a small hospital within the seat limit can pay by card without talking to Pulse first, unless Pulse staff have marked it a hospital.
  A hospital never may pay by card, and only Pulse staff can mark one, on the clinic's `/pulse` page, logged like every other change there; a clinic cannot set its own practice type, and a `practiceType` field in any clinic-side form is never read.
  No rows were changed: UNKNOWN rows stay UNKNOWN and simply count as clinics.
  A clinic staff are holding OPEN may pay; its first confirmed payment hands its access over to its payments.
  The seat limit is separate and also enforced on the server: more seats than the active version's Clinic maximum is Enterprise, quoted with no amount, and refused.
- **Issued patient links are untouched by all of this**, as always.
- To try it against real Stripe test mode on your own computer: put a test key and `BILLING_CHECKOUT="test"` in `.env`, run `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, and put the signing secret it prints in `STRIPE_WEBHOOK_SECRET`.
  Without the Stripe CLI the purchase still completes at Stripe, and "Check again" on the return page brings the clinic into line.

## Self-serve checkout

An admin of an eligible clinic picks categories, surgeon seats and monthly or yearly on `/admin/billing`, sees the total, and is sent to a payment page hosted by Stripe.
Card details never touch this app.
The flow is `startCheckout()` in `lib/checkout.ts` (server only); its pure rules are `lib/checkout-rules.ts`; everything it asks of Stripe goes through the `CheckoutGateway` in `lib/stripe.ts`.
**No schema was added for it:** the `BillingPlan` row from the billing foundation is the durable purchase attempt.

- **Where it is open.**
  `checkoutIsOpen()` in `lib/stripe.ts`: `BILLING_CHECKOUT` is exactly `"test"`, the key is a test key, **the deployment is not Vercel's production one, and the database is not production's** (compared with `PRODUCTION_DATABASE_HOST` by `databaseKind()` in `prisma/preflight.ts`, the operator scripts' check; on a computer, a database that cannot be told apart from production keeps checkout shut, and only a Vercel preview, which has no `PRODUCTION_DATABASE_HOST` to compare with, stays open without one).
  In test mode a "purchase" is paid with Stripe's public test card, so offering it on the production site would let anyone open a clinic for nothing.
  Opening checkout to real customers is part of going live, a reviewed change to that function together with the live keys.
  Where it is shut, the Billing page says plans are not open yet and the action refuses.
- **The server prices it (rule 8).**
  The form says what was picked and nothing about money that is believed: `readPlanSelection()` reads categories, seats, the interval, and which pricing version and total the admin was *looking at*.
  A clinic id, an amount, a discount or a founding flag added to the request is never read.
  The price is worked out from the **active** saved version (an estimate is refused) and the categories for sale right now (`listSellableCategories()`), with `practiceType: "clinic"` once eligibility has been checked (a hospital was refused there, and a clinic never marked counts as a clinic).
  A category that is not for sale, or is coming soon, is not a purchase option; a plan a clinic already has is never reduced because sale eligibility changed later.
- **Nobody pays a total they did not see.**
  If the version or the total differs from what was on screen (prices changed while the page was open, or a forged form), nothing is created, the admin is shown the new total, and has to press again.
  Once an attempt is written, its payment page charges that attempt's amounts even if the active version changes a minute later, and it pins that version when paid.
  The page stops being payable after `SESSION_MINUTES` (60).
- **One customer, one page, one subscription.**
  The clinic's Stripe customer is made with an idempotency key built from the clinic id and stored by `setStripeCustomer()` **before** anything else exists in Stripe.
  The attempt is written by `acceptPlanForCheckout()` under the clinic's row lock, where eligibility and "no live subscription" are checked again and an identical recent attempt is found instead of a second one being written (the clock is read after the lock is held, and a small negative age still counts as recent, or a double click would make two attempts).
  The payment page is made with an idempotency key built from the attempt's id, so identical requests get the same page.
  Every other open page of that customer is closed.
  If a different attempt became the waiting one while this request ran (two tabs, different picks), this request closes its own page and says so.
  Stripe answers a repeated key with its **first** answer, so for a reused attempt the page's current state is asked for: already paid sends the admin to the return page, closed starts a fresh attempt.
- **What Stripe is asked to charge** is `checkoutSessionParams()`, pure and tested: one line, the engine's per-seat amount for the interval as the unit price and the seats as the quantity.
  **A yearly plan is a yearly price of the whole year's amount**, never the monthly amount with "year" on it.
  One fixed product (`PRODUCT_ID`); Stripe generates a Price object for each page, which is fine: our versioned engine is the pricing authority, not Stripe's price list.
  The only payment method type asked for is `card`, with a fixed quantity, no promotion codes, no trial and no tax.
  (Stripe's page can still offer the card wallets and Link, including Link's bank option, that are switched on in the Stripe account's own settings; that is a Stripe setting to decide before live payments, and whatever is used, nothing opens until the invoice is paid.)
  The accepted plan's id goes on the **subscription's own metadata**, the only place the webhook looks.
- **Return addresses are trusted origins.**
  `pickTrustedOrigin()` in `lib/trusted-origin.ts` uses the request's Host header only to choose among addresses the deployment already knows are its own (Vercel's own variables, the optional `APP_ORIGINS` list, localhost on a developer's computer).
  With none, checkout is refused.
  Patient links, their QR codes and their pamphlets take their address the same careful way, through `qrOriginFor()` (see "Printed QR codes"): nothing is ever built from the Host header on its own.
- **The return page grants nothing.**
  `/admin/billing/return` reads the clinic's billing record and says confirmed, confirming, failed or nothing to confirm.
  Anybody can type its address; it changes no state.
  While confirming it looks again a fixed number of times and stops; then "Check again" (`checkPayment()`) finds the clinic's own subscription through its own customer id and runs the same `reconcileSubscription()` the webhook runs, which activates only on an active subscription with a paid invoice.
  It exists because a notification can be late, or unable to reach a deployment at all (a preview behind Vercel's sign-in).
  It is bounded too, harmless to repeat, and never starts another checkout.
  An admin who pays and closes the browser loses nothing: the webhook does the work.
- **One first payment at a time.**
  While Stripe has a first payment under way for the clinic (the record says INCOMPLETE, or Stripe has a subscription on the clinic's customer that has neither started nor died), no new checkout is started: `startCheckout()` asks Stripe first and brings the record into line with the same reconcile the webhook runs (a payment that has just gone through sends the admin to the return page), and `acceptPlanForCheckout()` refuses INCOMPLETE again under the lock.
  The admin is told to wait for it to clear or for Stripe to drop it (about a day for one that is never completed), and the Billing page shows "Your first payment is under way" instead of the picker, saying that a failed or unfinished payment is dropped by Stripe 23 hours after checkout started, with Check on your payment and **Check with Stripe right in that box** (audit finding E2), so the admin always has one working action: once Stripe has dropped it, Check with Stripe brings the record back to no subscription and the picker returns, even on a deployment no notification reaches.
  Cancelling the first subscription in Stripe was the alternative, and was not chosen: a bank payment already in flight can still arrive for a subscription that has been cancelled, and then has to be refunded by hand.
- **An existing subscription routes to its plan, not to a second checkout.**
  A clinic with a live subscription sees the plan it accepted, with the real amounts instead of an estimate, and is refused a new checkout on the server.
  Changing it, updating a card and cancelling are the next section.
- **Before live payments**, Evan and Van approve: the prices, founding terms, tax, refund and cancellation terms, and the customer-facing wording about recurring charges.
  The words on the picker today are test-mode placeholders.

## Sign-up's plan and payment steps

Built with the design of 2026-11-19 (screens 02-signup-2, 3, 3b and 03-welcome): after the email code, a new clinic's owner chooses a plan and pays without first landing in the admin console.
Stripe test mode only, like everything above, and offered only where Billing's own plan picker is.

- **The pages.**
  `/onboarding/plan` ("Choose your plan": category tiles, seats with minus and plus, Monthly or Yearly with "2 months free" beside Yearly when the prices make it true, "Your plan" with the total), `/onboarding/payment` ("Payment method", no subtitle) and `/onboarding/done` (the return from Stripe), all inside `SignUpFrame` (`components/sign-up`): the logo and "Finish later" across the top and the progress list on the left (Email, Plan, Payment), never the app's menu.
  "Finish later" goes to `/admin/billing`.
- **Offered only where Billing's picker is.**
  `requireSignUpPicker()` (`app/onboarding/sign-up-view.ts`) draws the steps only when `getCheckoutView()` would draw Billing's plan picker for the clinic, so `checkoutIsOpen()` (not edited), a missing pricing version, a first payment under way, a hospital, a managed clinic, a hand pause and a live subscription all keep them shut.
  In every one of those cases the person is sent to `/admin/billing`, which is exactly where a new clinic's owner went before (its "not open yet" card on production), so there is never a dead end and never a payment form; a member, or a clinic already open, goes to the library.
  There is no practice question to answer first: it was dropped from Billing (see "Who may pay by card").
  `app/onboarding/sign-up-pages.test.tsx` proves that with `VERCEL_ENV=production` and the real `checkoutIsOpen()`, neither step is offered and Pay is refused before anything is written.
- **The server prices it (rule 8).**
  The plan step only moves to the payment step with the picks in the address (`lib/sign-up-steps.ts`, read back by `readPlanFromAddress()`, which refuses anything it does not recognise).
  The payment page works the total out again on the server from the active version (`quotePlan()`, the same engine and inputs as Billing's picker), and "Pay $X and start" sends the picks and that total to `startSignUpCheckoutAction`, which is Billing's checkout (`checkoutFor()` in `app/admin/billing/actions.ts`) with only two differences: Stripe's return addresses, and a sentence for a sign-in that ran out mid-flow.
  Every guard above (one customer, one attempt, one page, one first payment at a time) is the same code.
- **The card is entered on Stripe's own hosted page**, not inside ours.
  The design draws Stripe's embedded form with express checkout buttons; that needs Stripe's browser script, a new package and a wider content policy, which were not added without asking (rule 6).
  The payment page shows the plan, the total, the money sentence and the test-mode line, and the button opens Stripe's page as Billing does.
- **Coming back.**
  `checkoutSessionParams()` takes `flow: "signup"`: Stripe sends a payment to `/onboarding/done` and a person who leaves its page to `/onboarding/payment?stopped=1` (`checkoutReturnUrls()`); its idempotency key ends `:signup` so Stripe never sees one key with two sets of return addresses (`checkoutIdempotencyKey()`); Billing's addresses and key are unchanged.
  A page already open for the same accepted plan is reused whichever flow made it, so its return address may be the other flow's; both return pages only read the record.
  `?stopped=1` shows "The payment was not finished. Nothing was charged. Try again, with another card or payment method if yours was declined." with the plan kept (from the attempt on record) and Try again: Stripe's own page says when a card is declined, and our page cannot know which it was, so it does not claim a decline.
- **The return grants nothing**, like `/admin/billing/return`: `/onboarding/done` reads the record, shows "Confirming your payment" with the same `Confirming` part (bounded looks, then Check again), and only once the record says ACTIVE and the clinic is open does it send the owner to `/library?welcome=1` (any other admin to `/library`).
- **The welcome dialog** ("Thanks for signing up.", `app/library/WelcomeDialog.tsx`) shows over the library only for the account owner, only when the clinic is open, and only with `?welcome=1`, which it takes out of the address as it opens, so a refresh or a second notification never shows it again; no schema.
  "Finish setting up (recommended)" opens setup (`/onboarding/setup`, the step the clinic is on), "Take a quick tour" goes to the library until the tour exists (pull request #6), and "Go to the library" closes it.

## One more seat from setup

Setup's team step (`/onboarding/setup/team`) offers **Add another** where a paying clinic may change its plan right now: exactly where Billing would show its change form (`getCheckoutView()` gives a "changer"), so test mode only and never on the production deployment; elsewhere the button is not drawn.
It opens **Add a seat?** (screen 04-setup-3b-add-seat): the plan's seats now and after, the new price with what it was, and what is charged today.
The change is built on the server, never from the browser: the plan in force with the same categories and interval, at the prices the clinic signed up at, plus one seat (`reviewAddSeat()` and `confirmAddSeat()` in `lib/plan-changes.ts`, called by `reviewAddSeatAction` and `confirmAddSeatAction` in `app/admin/billing/actions.ts`).
Both run through `reviewPlanChange()` and `confirmPlanChange()`, so every check of a plan change applies, Stripe is asked what it would charge today, and the live admin check runs before anything is bought.
What the confirmation sends back is only what it was shown (the pricing version, the new total, the moment and the amount due today, read by `readAddSeatConfirm()` in `lib/plan-change.ts`), and it is only compared: a second press, another admin's change or new prices make it "out of date", nothing is bought, and the new figures are shown.
Once Stripe confirms the payment the seat is the clinic's and a new email box opens.

## Plan changes and billing recovery

A clinic that is paying changes its plan on `/admin/billing`, and uses Stripe's own billing page for its card, its invoices and cancelling.
Stripe test mode only, and only where checkout is open (`checkoutIsOpen()`: never on the production deployment).
**No schema was added:** an accepted change is a `BillingPlan` row like any other, and `ClinicBilling.scheduledPlanId`, `scheduledChangeAt` and `pendingPlanId`, which existed, now carry copies of what Stripe says is waiting.
The timing rule is `lib/plan-change.ts` (pure; read its top comment first); the flow is `lib/plan-changes.ts` (server only); everything it asks of Stripe goes through the `PlanGateway` in `lib/stripe.ts`.

- **Who.**
  Any office admin, the account owner included (decided by Evan on 2026-10-05; the build plan had said the owner only).
  Every action starts with `getBillingClinicId()`, which is null for a member or anyone signed out; the page is an admin page, so everyone who sees it sees the buttons.
  A clinic that is managed by Pulse, a hospital, or paused by hand is refused (`planChangeBlock()`, the same sentence on the page and from the server), UNKNOWN counts as a clinic as everywhere, and a plan cannot be changed while the last payment is unpaid, while the subscription is set to end, or while another change is waiting for its payment.
- **The one rule about timing (the financial policy; it is not changed without Evan's say-so).**
  A change that only ADDS (more categories, more seats, or both, same interval, same prices) starts NOW, once its payment has succeeded.
  EVERYTHING ELSE starts at the NEXT RENEWAL, as one whole change: taking anything away, adding one thing while taking another away (a mixed change), monthly to yearly or back, and moving to newer prices.
  `classifyPlanChange()` sorts a change by what the clinic GETS (categories included, seats), **never by whether the price goes up or down**.
- **Review, then confirm.**
  "Review change" works out what the picks would do and changes nothing.
  For a change that starts now it asks Stripe what it would charge today and shows that amount, to the cent.
  Confirm sends back what was on screen; the server works everything out again, asks Stripe again FOR THE SAME MOMENT (the review's own clock, good for `REVIEW_MINUTES`, 15), and does nothing if the total, the amount due or the kind of change differs.
  Nothing the browser sends is charged.
- **Where the form starts, and the total while picking** (Prompt H, from the 2026-10-08 huddle).
  The change form opens from **Change plan** under Your plan (`?change=1`), or from an "Add to your plan" link; until then the page stays short.
  It opens on the plan the clinic PAYS FOR (the accepted plan in force), plus the one category from an "Add to your plan" link, and nothing else.
  That is what a change is priced and sorted against; the library opens `Clinic.categories`, which billing copies from the paid plan whenever a plan starts or changes, and which only differs when Pulse staff edited it by hand on `/pulse`.
  Where the two differ (`planLibraryGap()` in `lib/plan-change.ts`), the box says so ("Paid for, off in your library", "In your library, not paid for") and the page says, above the form, what Pulse turned off and what a change would do to a category Pulse added; a link asking for a category that is paid for but turned off ticks nothing extra and says there is nothing to add (decided in the billing-picks PR; Evan may overrule).
  Starting from `Clinic.categories` instead was not chosen: a plain add would then read as also taking the turned-off categories away, which waits for the renewal and stops paying for them.
  The first-plan picker reopens on a checkout that was started and not paid, except from an "Add to your plan" link, where it opens on the plan on file plus that category.
  Both forms keep a **running total** in view while picking (`RunningTotal` in `app/admin/billing/PlanFields.tsx`: pinned to the bottom of the screen while the form is on it, the total and the price per seat, a brief flash when it changes unless the computer asks for less motion, and, on the change form, what the plan comes to now).
  It is labelled an **estimate**: it comes from the same engine, but the amount that counts is the one shown by Review or on Stripe's page, and the server works the price out again (rule 8).
- **Prices.**
  A change is quoted from the pricing version on the clinic's CURRENT plan, the prices it signed up at.
  **Nobody is moved to other prices by loading a page or by a notification.**
  "Move to current pricing" is a tick box, offered only when the active version is a different one; ticked, the change is quoted from the active version and is always a renewal change, and the clinic's pin moves only when it takes effect.
  No founding offer is ever applied (none is approved, so there is none to preserve).
  A category the clinic already has may be kept through a change after it comes off sale; a new one must be for sale.
- **An upgrade** is one Stripe call: move the subscription to a price made for the accepted plan, invoice the difference now (`proration_behavior: "always_invoice"`, with the review's moment as `proration_date`), and only change the subscription if that invoice is PAID (`payment_behavior: "pending_if_incomplete"`).
  A declined card, or a card whose bank wants the charge approved, therefore changes nothing: Stripe holds the change aside with an unpaid invoice, the clinic keeps exactly what it had, and the page shows the change as waiting, with Pay now (Stripe's own invoice page, where an approval can be completed) and Cancel this change (the invoice is voided, which drops it).
  Stripe drops it by itself after about a day.
- **A renewal change** is a Stripe subscription schedule: the current period exactly as it is, then the new plan from the renewal date.
  A subscription has at most one schedule, so there are never two; a new renewal change replaces the waiting one in place, and Cancel this change releases the schedule.
  Nothing is charged or granted until the date.
  **Two settings there were found by testing against Stripe and must stay:** the new phase has `billing_cycle_anchor: "phase_start"` (without it a move from monthly to yearly made NO invoice for the first year), and the schedule is written with `proration_behavior: "none"` at the top and on the current phase (without it Stripe added stray lines to the next invoice, which came to a cent).
  An upgrade is refused while a change is scheduled: one change at a time.
- **Stripe says what happened; this app never grants a change itself.**
  A Stripe price is made once per accepted plan and marked with the plan's id.
  `reconcileSubscription()` reads three plan ids off the subscription every time it looks: the plan its price was made for (the plan in force: Stripe only moves a subscription once an upgrade is paid or a scheduled date arrives), a plan in a pending update (waiting for its payment), and the plan in the schedule's next phase (with its date).
  `decideBilling()` applies the first and copies the other two into the record, with one log entry per real change.
  So a late or repeated notification cannot grant a scheduled category early, and a change that never happens leaves only an unused `BillingPlan` row and an unused Stripe price.
  A plan id that is not one of this clinic's own accepted plans is never acted on and is flagged "Needs a look" on `/pulse/billing`.
- **One change at a time.**
  The accepted plan is written under the clinic's row lock (`acceptPlanForChange()`, which rechecks eligibility, the plan being changed FROM, and the seat floor).
  The Stripe calls then run inside `withPlanChangeLock()`, which holds the clinic's **plan change lock** (a named lock only other plan changes at the same clinic wait for, so links are never held up by Stripe; since audit finding E1 it is no longer the row lock) and starts by asking Stripe where the subscription stands: a second request waits, sees what the first did, and is told the plan has moved (or, for the very same change, that it is done).
  The work inside that lock writes nothing to the database, so a failure after Stripe made the change loses nothing: the reconcile straight afterwards, and Stripe's own notification, apply it.
  **A change that overruns stops** (audit finding E7): the lock is held for at most 45 seconds, counted from the start of the transaction, so including any wait behind another change; after 25 seconds counted the same way (the clock starts just before the transaction does), no new Stripe write is started (`ensureHeld()` before each one throws `PlanChangeOverrunError`).
  A write that does start therefore has at least 20 seconds left, more than a Stripe call is allowed (eight seconds, once retried); only a Stripe call that hangs past its own limit could outlast the lock.
  While a plan change talks to Stripe, a look at Stripe (a notification, Check with Stripe) is not held up by it and applies what Stripe says at that moment; the look the plan change makes straight afterwards applies the finished change.
- **Stripe's billing page** (`openBillingPortal()`): update the card, see invoices, cancel at the end of the paid period (and undo that before then).
  It is opened for the Stripe customer on the clinic's own record, never one from a request, with settings the app makes and names itself (`ensurePortalConfiguration()` in `lib/stripe.ts`) in which **changing the plan is switched off**, so nothing there can skip the seat and category rules.
  It stays reachable for a clinic that is past due or ended, and is refused for a clinic Pulse manages and before a first payment has been confirmed (`billingPortalAllowed()` in `lib/plan-change.ts`, which the page draws the button from and the server asks again).
  Stripe refuses a cancellation while a schedule is attached, so a schedule whose change has already happened is released before the visit.
  While a real change is scheduled, Stripe's page still offers Cancel subscription (seen on the preview, 2026-10-05); whatever it leaves behind is read from Stripe like everything else (a cancellation date, and the scheduled change gone if Stripe dropped it).
  The cancellation terms are NOT approved: end-of-period with no refund is the test-mode placeholder.
- **The payment method and billing history on the page** (built with the design of 2026-11-19, `getBillingHistory()` in `app/admin/billing/history.ts`): the card on file (brand, last four digits and expiry, or the kind of method when it is not a card) and the newest six invoices (`BILLING_HISTORY_LIMIT`), each with its date, what it was for (from Stripe's own reason: first payment, renewal, plan change), its amount and status as Stripe reports them, and Stripe's own page for it (only an address on `invoice.stripe.com`).
  Read from Stripe at the moment of asking, through `readBillingRecord()` in `lib/stripe.ts`, and never stored: no schema, no package and no change to the content policy (the receipt is a link, opened in a new tab).
  Asked only where Stripe's billing page may be opened (`portal`, the same gate as Update on Stripe), for the customer and subscription on the clinic's own record.
  When Stripe cannot be reached, the page says so in a calm sentence and the rest of the page is unaffected; only the kind of failure is logged.
  Older invoices are on Stripe's billing page.
- **Recovery.**
  A clinic whose renewal failed sees "Settle the missed payment", which goes to Stripe's page for that invoice (`findInvoiceToPay()`, which hands out an invoice only where the page offers one: a missed renewal, or an upgrade waiting for its payment, never a first payment; `invoicePaymentAllowed()`), and can change its card on Stripe's billing page.
  Coming back from Stripe proves nothing: the clinic recovers when Stripe says the invoice is paid, by notification or by "Check with Stripe" (any admin; the same reconcile, safe to repeat).
  An ended clinic starts again with the plan picker.
- **Notifications.**
  The webhook also handles `customer.subscription.pending_update_applied` and `pending_update_expired`, `invoice.voided`, and the five `subscription_schedule.*` events.
  Which events Stripe SENDS is a setting on the webhook endpoint in the Stripe dashboard, changed by Evan, never by code; without the new ones the app still catches up from `customer.subscription.updated` and from Check with Stripe.
- **What this does not do.**
  A change made by hand in the Stripe dashboard (a price, a quantity, a schedule) is not understood as a plan and is flagged, not applied.
  Stripe's billing page itself cannot be driven from a test and is a click-through; a cancellation made there while a change was scheduled has not been followed through to the renewal.
  Year-to-month at a renewal could not be run on a Stripe test clock (the clock will not advance a year) and rests on the same code path as month-to-year, which was.
  **Before live payments** the list above (prices, founding terms, tax, refund and cancellation terms, the wording about recurring charges) still stands, plus the words on the change form and the billing-page settings.
