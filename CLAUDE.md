# CLAUDE.md

The rules file for the `patient-education-platform` repository, where it lives as `CLAUDE.md` in the root.
Claude reads it automatically at the start of every session, so this is the one place project rules belong.

A copy is kept on the desktop as `3 - Repo rules file.md`. If you edit one, copy it to the other.

---

## What this is

The Pulse 3D Patient Education Platform. Surgical patient education animations, delivered to patients on their own phones.

A clinic creates a share link. The patient scans a QR code or opens the link, watches an animation explaining their upcoming procedure, and the link stops working seven days after the patient first plays it, or after ninety days if nobody ever does (both numbers are settings; see "How a link expires").

**Phase 1 is done:** create a link, watch a video, link expires.
**We are in Phase 2, the clinic dashboard:** logins (done, see Auth), clinics and people (done, see Roles), the Pulse 3D master dashboard (done, see the four surfaces), the clinic admin area's sections (done: overview, shared links, people, billing), clinic branding (implemented, device acceptance pending), then billing and real video hosting.
**Billing is being built in steps, in Stripe test mode only.** Done: the payment-state foundation (what is stored about a clinic's subscription, the rule that turns it into access, and the webhook that keeps it true; see "Billing state"). Also done: self-serve checkout, where an eligible clinic's admin picks a plan on `/admin/billing` and pays on Stripe's own page (see "Self-serve checkout"). Also done: surgeon seats and the account owner (see "Surgeon seats"). Not built: plan changes, updating a card, invoices. **Nothing real is ever charged: the app refuses a live Stripe key, and test-mode checkout is never offered on the production deployment.**

## This repository is public

Deliberate, for now: Vercel's free plan will not deploy a private repository owned by an organization, and we are pre-revenue. It goes private when we move to Vercel Pro, which will be before launch.

Two consequences while it stays public. **No secret may ever be committed** (see rule 7, which is the most important rule in this file today). And anything written here is readable by anyone, so no client names, no unreleased animation stills, and no commercial detail that is not already on the public website.

## Who works on this

**Evan Miller, solo.** He is a marketer, not a programmer, and builds entirely with Claude Code. Van Miller (founder) reviews but does not write code.

**Write code that a non-programmer can follow.** Prefer obvious over clever. Comment anything that would not be self-evident to someone reading it for the first time. When there is a simple way and a sophisticated way, take the simple way. If a task needs a concept he will not have met before, explain it in one plain sentence before using it.

---

## Hard rules

### 1. All database access happens on the server, and only through `lib/db`.

Two parts, both required.

**Server only.** Read and write data in Server Components, Server Actions or route handlers. Never send the database connection string to the client. Never install or use a database client in browser code.

**Only through `lib/db`.** Pages and components never call Prisma directly. Every query lives in a named function in `lib/db/`, and **any function that touches clinic-owned data takes `clinicId` as its first argument.**

```ts
// lib/db/shares.ts
export async function createShare(clinicId: string, videoId: string, days: number)
export async function listSharesForClinic(clinicId: string)
export async function getShareByCode(code: string)   // public, no clinic needed
```

**The `clinicId` comes from the server's own check of who is signed in** (`getCurrentClinicId()`, see Auth), never from a form field, a query string or anything else the browser sent. A clinic id that arrives from the browser is untrusted input, not an identity.

The only functions that take no `clinicId` are the ones behind the patient's link, where the share code in the URL is the key: `getShareByCode()` and `recordSharePlay()`. That is the whole list. If a task seems to need another public-by-code function, say so first.

Why both: in Phase 1 `clinicId` came from a single constant. In Phase 2 it comes from the signed-in user. **Because the seam already existed, Phase 2 was a swap, not a rewrite** - and there is exactly one place to check that clinics cannot see each other's data.

### 2. No patient-identifying information, anywhere, ever.

No names, no dates of birth, no email addresses, no medical record numbers, no clinical notes. A share link is tied to a **procedure** and a **clinic**, never to a person. No patient profiles, no marketing or advertising tracking on the patient page, and no patient-facing sales features, ever.

The staff side is different: a staff member's identity is used for sign-in, for permissions and for the clinic log, and that is fine. It is patient data that never enters the system.

**This is a product constraint, not a legal conclusion.** Storing no patient identifiers keeps the platform simple and is the reason we assume it sits outside HIPAA's scope, but that assumption has not been checked by anyone qualified to check it, and hosting, logging, the video host and any future analytics all receive data too. Never write, in code, docs, copy or a PR, that the platform "is outside HIPAA" or "is HIPAA compliant". The honest sentence is: it stores no patient identifiers, and the whole data flow is to be reviewed before any hospital contract.

If a task appears to require storing patient information, **stop and flag it** rather than building it.

### 3. Never change the database schema unless explicitly asked.

`prisma/schema.prisma` is the foundation everything else sits on. If a task seems to need a new column, table or relation, **stop and say so first.** Never rename or delete an existing field. A change that is approved is **additive**: a new column has a default or is optional, and existing rows and fields are preserved. Anything else needs its own written migration plan, approved separately.

**Never change the database by hand in the Neon console.** Every change is a Prisma migration, committed to git. Hand edits break migration history in ways that are painful to unwind.

**How a schema change ships: production last, on Evan's word.** A git revert does not undo a migration, so the production database is the one thing a pull request must never change before it has been reviewed and released. The order is:

1. **Write the migration without connecting to production. Preferably without connecting to anything.** Save the schema as it is on `main` (`git show main:prisma/schema.prisma > <scratch>/schema.old.prisma`), edit `prisma/schema.prisma`, then have Prisma diff the two files: `npx prisma migrate diff --from-schema-datamodel <scratch>/schema.old.prisma --to-schema-datamodel prisma/schema.prisma --script`. Put that SQL in a new folder, `prisma/migrations/<UTC timestamp>_<what-it-adds>/migration.sql`, and **read it** before going on. If a task genuinely needs `migrate dev` (to rehearse the SQL against a real database), it may only run with `DATABASE_URL` and `DIRECT_URL` pointed at an explicitly identified development database (the `testing` branch, or a throwaway Neon branch made for the purpose) plus a separate disposable shadow database, both named in the PR. **`--create-only` is not a safety boundary**: it still connects, and a second run applies the pending draft. The main checkout's `.env` is production, so `migrate dev` never runs there, with any flag.
2. **Apply it to the `testing` branch and run the tests.** `DATABASE_URL=<testing pooled> DIRECT_URL=<testing direct> npx prisma migrate deploy`, then `npm test`. (A Neon branch shares its parent's password, so the direct string is the pooled one with `-pooler` removed from the host.) Never reset the testing branch to do this; `migrate deploy` is enough, and a reset throws away what the tests had there.
3. **Push and open the pull request.** The description lists the migration, its SQL in plain words, any script that changes rows, the order production will be migrated in, why the old code keeps working on the new columns in the minutes between the migration and the deploy, and how it would be recovered if it went wrong. Neon clones the preview's database from production when the PR opens, so the preview does not have the migration yet: apply it to the preview branch the same way (its strings are under Neon, Branches, `preview/<branch name>`), then check the preview page that uses the new columns. Never reset the preview branch either; if it has fallen behind production, say so and let Evan decide.
4. **Evan reads the summary and then says whether to release.** Reading it is the review; it is not the release. **Nothing touches production until Evan gives an explicit instruction after that review**: not the migration, not a data script, not a vendor setting, not the merge. When he does, apply the migration to production with `npx prisma migrate deploy` from the main checkout (whose `.env` is production; that is the one deployment command, never `migrate dev`, never `migrate reset`, never `db push`), run any data script, and then merge. Production is migrated right before the merge, not after it, because the new code expects the columns the moment Vercel deploys `main`; the old code ignores columns it does not know, so the minutes between the migration and the merge are safe.
5. **Point-in-time restore must be on for the production branch** (Neon, project settings, history retention) before any production migration. Check it once; it is the undo button.

A migration that turns out wrong is fixed forward with another migration that only adds. An applied migration is never edited, never deleted from the folder, and never rolled back by hand.

### 4. Do not remove things that look unused.

Several fields exist for later phases and are deliberately unused right now, including `Video.isPublished` (only ever set by the seed scripts so far). **They are load-bearing later. Leave them alone.**

### 5. One task at a time. One prompt is one pull request.

Do the thing that was asked, not the three adjacent things that would also be nice. If you spot something else worth doing (a bug from a review, an item from the build plan, a tidy-up), say so and wait; it becomes its own prompt and its own PR. Small changes are reviewable by someone who cannot read code; large ones are not. **The title and description of the PR describe what it finally contains**, so if the scope moved during the work, rewrite them before asking for review.

### 6. Do not add dependencies casually.

Ask first, and say what the package is for in plain English.

### 7. Never commit secrets. THIS REPOSITORY IS PUBLIC.

Everything sensitive lives in `.env`, which stays out of git. `.gitignore` must always cover `.env*`.

**The repository is public while we are pre-launch.** That raises the stakes on this rule considerably:

- A committed database URL or API key is found by automated scanners **within minutes**, not eventually.
- **Git history is permanent.** Deleting the file in a later commit does not remove the secret from history. Anything committed once must be **rotated**, not just deleted.
- **Never hardcode a connection string, key or token anywhere in the code**, not even temporarily while testing. If a value is needed, it comes from `process.env`.

Before any commit that touches configuration, confirm `.env` is still ignored.

**"Secret" is wider than keys.** None of the following goes into code, test fixtures, screenshots, logs, docs, commit messages or PR text: credentials; a real clinic's private data; anything about a patient (there should be none, see rule 2); a live share link or its code; a signed playback address; a webhook body; unreleased commercial detail. Test fixtures use made-up values and synthetic connection strings, and nothing ever prints a connection string, not even to say it was rejected.

### 8. The server decides. The browser only asks.

Prices, access, ownership, roles, seat counts and limits are worked out on the server for every request that matters, from what the server itself knows. A value the browser sends is a request, never a fact: the server recomputes it. **Hiding or disabling a button is a courtesy, never authorization**, and every Server Action and route handler rechecks who is asking before it changes anything.

- **Writes to what is shared across clinics need Pulse staff.** The catalogue, category settings, pricing, platform settings, reporting and anything that manages a clinic from the outside: every such action calls `requirePulseStaff()` first. Clinic operations need the right organization role, checked on the server with `isClinicAdmin()` or the clinic lookup.
- **Reject bad input at the edge.** An enum value the code does not know, a duplicate, a number that is not finite, a value outside what the column or the business allows, malformed form data: all refused with a plain message, never stored, never guessed at.
- **Client-safe modules never import server modules.** A file that runs in the browser (anything under `"use client"`, and any type, constant, validator or calculator it imports) must not import `lib/db`, Prisma, a signing key, Clerk's backend client, the settings row or a clinic's internal notes. Put the shared pieces (types, defaults, help text, validators) in a plain module with no server imports, and import that from both sides; `lib/pricing.ts` is the model. Two client components still import `lib/db` today (`app/pulse/settings/SettingsForm.tsx` and `app/pulse/videos/CategoryConfigForm.tsx`); they are known bugs on the review checklist, not a pattern to copy. When a server-only guard such as the `server-only` package is practical (and mocked for Vitest), add it so the boundary is enforced rather than remembered.
- **Lists and histories are bounded.** Any list that can grow (links, notes, videos, clinics, people, events) is read with a limit, paged, or aggregated in the database. Never load a whole operational history into a page or the browser.

---

## Working on a task

### Starting

- **Read before editing:** this file, `AGENTS.md`, the code the task touches, `prisma/schema.prisma` and the migrations folder, the tests next to that code, and any review notes the prompt points at. Look at `git status` and recent history, and preserve work already present: never overwrite a branch, a file or an uncommitted change you did not make.
- **One focused branch from the latest reviewed `main`**, unless the prompt names another base. **Branch names are 17 characters or fewer** (Vercel's preview address is built from the branch name, and a longer one gets a hash nobody can guess). If the branch already exists, look at what is on it and pick a clear short variant instead of reusing it.
- Say, briefly, what the change will do and how it will be checked, then do the routine in-scope work without stopping for approval. **Ask only when the answer is a business decision, when a credential or an access grant is needed, when an action is destructive, or when the scope would grow meaningfully.** A guess at a business decision is worse than a question.
- Rule 5 applies: one prompt, one PR. Review findings and roadmap items the prompt did not name are reported, not folded in.

### Mutations and outside services

- **A form keeps what was typed when something goes wrong.** Validation error, lost connection, a rejected action: the draft stays, a plain sentence says what happened, and there is a way to try again. A form is cleared only after the server has confirmed success. The technical detail (the exception, the status code) goes to the server log, never to the screen.
- **A retried mutation must be safe to repeat.** A disabled button does not stop a double submit, two open tabs, a flaky connection that resends, or a webhook that retries. Design each write so doing it twice gives the same end state: look up by a unique key before creating, catch the unique-constraint error (Prisma `P2002`) and retry the code rather than pre-checking, record an idempotency key where an outside service will call us.
- **Read, decide and write in one transaction when the decision depends on the read.** Two staff members saving at once must not each describe a stale "before". When a change has a log entry, the entry and the change commit together and describe the same transition (`changeClinicWithLog()` in `lib/db/clinics.ts` is the pattern; its read takes a row lock inside the transaction, so overlapping saves describe the actual previous values). For any write that matters, test a forced overlap, not just the happy path.
- **Every outside service fails sometimes.** Clerk, Stripe, Mux, Neon, Vercel, the CDN. Before claiming two systems stay in step, write down which one is the source of truth for each fact, what happens if the second write fails after the first succeeded, how a retry is made safe, and how the two are reconciled later. "It worked in the test" is not that.
- **Webhooks.** Verify the signature against the raw request body, exactly as the sender documents. Expect the same event twice and events out of order. Do the work, or put it somewhere durable, before answering with success; an acknowledgement sent first and work done second loses the work when the process dies. Never log the body, a secret, a share code, a signed URL or a patient-facing link.

### Before you say it is done

- **Check the boundaries, not just the feature:** signed out, a member, an admin, a member of a different clinic, Pulse staff; invalid input; what happens when the request fails; the overlap case where two writes race; and that what already worked still works.
- **Run lint, `tsc`, the tests and a production build** (`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`), and read the output. Database tests run only against a positively identified non-production target; the guard in `vitest.setup.ts` refuses anything else and that refusal is never worked around. Pure tests should not need a service secret to start.
- **Mocks prove the logic; they do not prove the service.** Where behavior depends on Clerk, Stripe, a real browser or a real phone, a mocked test is not the end-to-end check. Say which.
- **UI work is looked at in a browser**, on the real page, with the real field. Patient and surgeon playback is tried on real phones and tablets, and the report names the device, the browser, the network (cellular, clinic Wi-Fi), whether it was a cold or a warm start, and every failure. Claude cannot sign in to Clerk, so the signed-in click-through is a numbered list for Evan, with what he should see at each step.
- **Never call the work complete when a required check was skipped.** The report says exactly what was run and observed, what was only simulated, what failed, and what remains for Evan to verify. "Should work" is not a result.

---

## The four surfaces

The app is four different screens for four different people. Keep them separate from the start, because each is gated by a different role and that is much easier if they were never mixed.

| Surface | Who | Device | Access |
|---|---|---|---|
| `app/watch/[code]` | **The patient** | Their own phone | Public, no login, ever |
| `app/library` | **The surgeon**, in the room | Tablet or phone | Clerk sign-in, any member of an open clinic |
| `app/admin` | **The office manager** | Desktop | Clerk sign-in, `org:admin` of the clinic (see Roles). Every page but `/admin/billing` also needs the clinic to be open (see the billing exception below) |
| `app/pulse` | **Pulse 3D staff** (Evan and Van) | Desktop | Clerk sign-in plus `isPulseStaff()`. Anyone else gets not-found. |

**`app/watch` is the patient's page, and it stays about one thing.** No account, no email, no app to install, no consent screen, no second confirmation, no cookie banner before the video plays. One procedure, the clinic's name (and logo), calm plain language, large controls, and nothing else: no navigation, no related videos, no sales, no link to anywhere but play. See the speed rule below.

**`app/library` is the exam-room surface.** A surgeon opens it mid-consult, finds the procedure, and either plays it right there on their own device or sends the patient a link. It is used standing up, in front of a patient, under time pressure. **It obeys the same speed rule as the patient viewer**: tablet-first, big touch targets, **browse to playing in two taps**, Play and Send as **separate one-tap actions**, no dense tables. It shows only what the clinic's plan allows (see Category entitlements): a category off the plan is a locked tile and a locked page, never a list of videos.

**`app/admin` is the back-office surface**, and its pages have fixed jobs. Keep this map stable; do not move a job to another page or merge two of them:

| Page | Job |
|---|---|
| `/admin` | The office manager's **overview**: the notice from Pulse, what needs a look (links that stopped working, links about to expire), a few counts, the newest five links, and a card into each section. Not the full list of anything: it reads five counts and five rows (`summarizeSharesForClinic()` and `listRecentSharesForClinic()` in `lib/db/shares.ts`), never the whole history. |
| `/admin/links` | **Every share link and QR code**: create, search, filter, copy, download the QR picture, print the pamphlet, cancel. The complete workspace. The pamphlet (`/admin/print/<code>`) and the QR picture (`/admin/qr/<code>`) belong to it. |
| `/admin/people` | Everyone in the clinic and the clinic's seats: "2 of 3 seats in use", Member / Member with admin on each person, Give a seat and Remove, inviting someone (an invitation holds a seat) and revoking an invitation, the account owner's handoff, and in plain words anything that needs settling (people waiting for a seat, a plan that pays for fewer seats than are taken, no account owner). "Choose a plan first" until the clinic is open. Clerk's organization panel stays at the bottom for the clinic's name and logo. See "Roles" and "Surgeon seats". |
| `/admin/billing` | Plan, categories, seats, and an estimate labelled as one; the plan picker and the way to Stripe's payment page for a clinic that may pay by card; the subscription it is paying for once it has one; later the payment method and invoices. `/admin/billing/return` is where Stripe sends the admin back to. **The only place plan or price information appears on the clinic side.** The plan on file and its estimate come from `getBillingView()` in `app/admin/billing/billing.ts`, which reads the plan through `getClinicPlan()` and quotes it with the engine in `lib/pricing.ts`; what is offered for sale comes from `getCheckoutView()` in `app/admin/billing/checkout-view.ts`. No page repeats the arithmetic. |
| `/admin/branding` | Clinic logo instructions, one brand colour, a font from the short list, and office phone. Admins of open clinics only; colour, font and phone saves are logged. |
| `/admin/reports` | Clinic reporting, when built. A placeholder page today, marked Coming in the navigation, so the link never leads nowhere. |

**Never turn the overview back into the links list, and never put plan or billing detail on the overview or on the links page.** Every admin page draws itself inside `AdminFrame` (`app/admin/AdminFrame.tsx`): the app shell, the clinic's name, the row of section links (`AdminNav`, driven by the list and the current-page rule in `lib/admin-nav.ts`), then the page's own title. The frame is drawn only after the page has checked that the person is an admin; a member gets `<AdminsOnly />` and no navigation at all. An admin of a closed clinic does get the frame on every page, with the closed-clinic message in place of the content, so Billing is always one tap away.

**Billing stays reachable when the clinic is not open.** A clinic that is PENDING, PAST_DUE, PAUSED or CANCELED cannot use the library or make new links (`clinicIsOpen()` says so), but its admin must still be able to open `/admin/billing` to see why and fix it: choose a plan, update a card, restart. So **permission to view and repair billing is separate from permission to use the app**, and `/admin/billing` is never behind the `ClinicClosed` page: it checks `isAdmin` and deliberately not `clinicIsOpen()`, and shows the status with what it means instead. A clinic that is managed by Pulse (`managedByPulse`) sees its plan as read-only, with no self-serve billing controls and a line saying Pulse manages it. A member who opens it is told, in plain words, that billing is handled by the clinic's office admins. What can be done there is in `app/admin/billing/actions.ts` and works for a closed clinic: choosing a plan and going to pay for it, and checking on a payment (see "Self-serve checkout"). Nothing on the page asks what kind of practice the clinic is: only Pulse staff mark a hospital, on the clinic's `/pulse` page, and a clinic that was never marked is treated as a clinic (see "Who may pay by card" under "Billing state"). Where no plan can be chosen (a hospital, a managed clinic, a clinic Pulse paused by hand, a deployment where checkout is not open, no published prices) the page says so and points at Pulse; it never shows a dead button. A clinic whose payment failed but whose grace period is still running is open, and the page says the payment failed and until when.

**`app/pulse` is the Pulse 3D master dashboard.** Used only by Pulse staff, Evan and Van. It shows every clinic, every video, and every price and rule. **Nothing on it is visible to clinics.** It is not a bigger `app/admin`: admin shows one clinic its own data, pulse sees across all of them, so the two never share a page.

**Who may open it is decided in one function, `isPulseStaff()` in `lib/pulse.ts`.** A person is Pulse staff when their Clerk user has `pulseStaff: true` in its public metadata, set by hand in the Clerk dashboard (Users, the user, Metadata, Public) and nowhere else. It is read on the server from Clerk's backend API on every request. **Every page and every Server Action under `app/pulse` calls `requirePulseStaff()` first**, which ends the request with not-found for anyone else: not a redirect, not a message, so the dashboard's existence is not confirmed to people who cannot use it. The `/pulse` layout checks too, so the not-found page has no dashboard rail around it. Never check this in the browser only.

Built so far: the clinics table (`/pulse`), one clinic's page (`/pulse/clinics/[id]`, seven sections behind a row of pills: Overview with access set by hand, managed-by-Pulse, the read-only Card billing facts and the practice type, Plan, Details, Branding, People (with "Make account owner", the backup for an owner who left), Links, and Notes, an append-only log to which every change saved on the page adds an entry of its own; the clinics table flags a clinic with "No account owner"), the catalogue (`/pulse/videos`: every video, the add and edit form, and the Categories panel), the platform settings (`/pulse/settings`) and pricing (`/pulse/pricing`: the numbers behind every quote, a live calculator, and the saved versions with Make active on each), and billing diagnostics (`/pulse/billing`: what became of each notification from Stripe, the ones that need attention first, and Try again on a failed one; never a key, a secret, an error message or what a notification contained). Reports is a placeholder page.

## Phase 1 scope

**In scope:** the three original models (Video, Clinic, Share) · `app/library` to browse and play · `app/admin` to create and manage share links · `app/watch/[code]` for patients · QR code generation · link expiry.

**Still not built unless a task asks for it:** plan changes (adding or removing seats on a paid plan included), updating a card, the Stripe customer portal, invoices, tax, a founding discount, analytics dashboards, email sending, video uploading, file storage. (The billing state, the Stripe webhook, self-serve checkout and surgeon seat limits exist; see "Billing state" and "Surgeon seats".)

**Do not invent a login system.** Sign-in is **Clerk** (see Auth), and its organizations feature is what models clinics and doctors. Never add a users table, a password field or a session cookie of our own.

If a request seems to need something on the not-built list, say so before building it.

## Phase 2 scope

Phase 2 is the clinic dashboard: logins, clinics, doctors, permissions, real video hosting. It also adds **`app/pulse`**, the Pulse 3D master dashboard (see the four surfaces above).

**Decided: self sign-up with card payment.** Solo (1 surgeon) and Clinic (2 to 10 surgeons) sign themselves up and pay by card. Enterprise (11 or more surgeons, or any hospital) is set up by Pulse from `app/pulse`. **Decided by Evan on 2026-09-25: clinics are not asked whether they are a clinic or a hospital.** The seat limit is what sends a big practice to Pulse (more seats than the active pricing version's Clinic maximum, 10 by default, is Enterprise, quoted with no amount and refused at checkout), and only Pulse staff can mark a clinic a hospital, on its `/pulse` page. The trade-off, accepted: a small hospital with that many surgeons or fewer can pay by card without talking to Pulse first, unless Pulse staff have marked it a hospital. The payment state underneath it and the checkout itself are built, in Stripe test mode (see "Billing state" and "Self-serve checkout"). Prices, founding terms, tax, refund and cancellation terms and the customer-facing wording about recurring charges are **not approved yet**; Evan and Van approve them before live payments, and nothing in the code should be read as having decided them.

**Built so far:** a person signs up, creates their clinic (a Clerk organization) at `/onboarding`, becomes its account owner, and goes straight to `/admin/billing` on a PENDING clinic that shows "Choose a plan to start" until Pulse staff open it by hand on `/pulse` (or with `npm run db:set-status`), or its first card payment is confirmed by Stripe. Once it is open, admins invite people from `/admin/people` (each invitation holds a seat) and switch admin on or off for each person. Pulse staff set each clinic's plan (categories and surgeon seats) on `/pulse` or with `npm run db:set-plan`. The categories on the plan decide what the clinic's library shows and what it may share (see Category entitlements below), and the surgeon seats decide how many people may hold one (see Surgeon seats).

### Pricing shape

Pricing is a **ladder by number of categories, per surgeon seat**: one monthly price per seat for one category, another for two, and so on, whichever categories they are (defaults $59 / $89 / $109 / $125 / $139 for one to five). A clinic is charged the ladder price for the number of categories it takes, times its surgeon seats; a year is charged as a set number of months. Office staff are never charged. **Decided by Evan on 2026-09-11 (the record is at the top of `lib/pricing.test.ts`): the rounded ladder is the product, to the cent.** There are no per-category prices: a count-based price makes the identity of the categories irrelevant, and a price of a category's own would be a second pricing mode to decide on before it is built. **The ladder never goes down** (decided by Evan on 2026-09-12): each rung is at least the rung before it, equal rungs allowed, and `validatePricingConfig()` refuses a ladder that breaks this, so it can be neither saved nor activated. The numbers are placeholders to edit on `/pulse/pricing`; the model is settled.

- **The engine is `lib/pricing.ts`**, pure and safe for the browser. `quote(config, input)` returns exact whole cents. The one rounding is the per-seat amount for the interval, after the founding offer if there is one, and the total is that times the seats; Stripe will be given that per-seat amount as the unit price. The monthly equivalent of a yearly price is for display only and is never charged.
- **The numbers live in `PricingVersion` rows, never in code.** `getActivePricing()` in `lib/db/pricing.ts` is the only way to read them, and `getPricingForClinic(clinicId)` uses the clinic's pin when it has one. With no active version it returns `DEFAULT_PRICING_CONFIG` marked as an estimate; checkout refuses an estimate and insists on a saved, active version, so nothing is for sale until Pulse staff have made one active. Never write a price literal anywhere but those defaults.
- **The full library** (taking `fullLibraryFrom` categories, 5 by default) is charged at that count's ladder price and includes every category. It is only offered while every category is for sale; otherwise a clinic taking that many pays that count's price for, and gets, just those, and the quote says so. `selectedCategories`, `chargedCount` with `chargedCategories`, and `entitledCategories` are separate things and stay that way.
- **Solo, Clinic and Enterprise** come from the seat limits on the config (defaults 1 and 10) and the practice type the quote is asked with. A hospital is always Enterprise, with no self-serve amount; it is never guessed from a name, and it is never asked: only Pulse staff mark one.
- **The founding offer is 0 by default, and checkout never applies one.** A number modelled on the calculator is not an offer to a customer. A real one needs a written rule for who qualifies and for how long. Until that rule is approved and built, checkout always quotes with `founding: false`, whatever the active version's number is; the picker is not even sent that number; and nothing a browser sends can ask for it. When a rule exists, the accepted plan gains a column recording the terms (additive, 0 for every earlier plan, which is the truth), and if Stripe coupons carry it they are keyed by those immutable terms, never one coupon id edited in place.
- `listSellableCategories()` decides what a NEW purchase may include. It never removes a category a clinic already has; Pulse staff can grant one early on the clinic's Plan form, where a category that cannot be bought is labelled Not for sale or Coming soon.
- **A quote shown to a clinic is recomputed on the server** from the clinic's own plan and the pricing version the server chooses (rule 8). Nothing the browser sends decides a price.

### Category entitlements

A clinic can browse, play and issue new links only for the videos its current access permits. The rule is one pure function, `decideVideoAccess()` in `lib/access.ts`, and access requires all four of: the clinic is open (`clinicIsOpen`), the video is published, the video's category is on the clinic's plan (`Clinic.categories`), and, for a placeholder, the clinic is shown placeholders (`Clinic.showPlaceholders`). `managedByPulse` plays no part: it says who manages billing, so a managed clinic that is paused is closed and a managed clinic with no categories has none. Whether a category is for sale plays no part either: `listSellableCategories()` governs new purchases, and a category already on the plan stays usable when it comes off sale.

- **The categories on the plan are the effective category set.** `Clinic.categories` is what the rule reads. When a self-serve clinic's first payment is confirmed, billing writes the accepted plan's entitled set (`entitledCategories` from the pricing engine, every category when the full library is bought) into `Clinic.categories`, so the rule needed no change for checkout.
- **The reads live in `lib/db/access.ts`.** `getClinicAccess(clinicId)` reads the clinic once (status, plan, placeholder setting); pages call it once per request and decide for everything they list in memory, never once per card. `canUseVideo(clinicId, videoId)` answers for one video with the reason when the answer is no. The clinic id always comes from `getCurrentClinicId()`, never from the browser; a clinic id in a form is ignored, so a forged one cannot borrow another clinic's plan.
- **`createShare()` is the guarded write, and the check and the write are one moment.** Inside one transaction it reads the clinic and the video with a share lock (`lockClinicAccess()` and `lockVideoFacts()` in `lib/db/access.ts`, plain SQL with `FOR SHARE`, because Prisma's query builder cannot ask for a row lock), asks the rule, and throws a `ShareRefusedError` with a plain message (from `accessRefusalMessage()`) when the answer is no, writing nothing. The locks hold both rows against change until the transaction ends, so a plan removal, a pause, a placeholder-setting change or an unpublish that arrives while a link is being made either waits for the link to commit (and then applies, leaving the issued link usable, as issued links always are) or landed first and is seen by the locked read. Two links being made at once for the same clinic do not block each other. Both share-creating actions (the admin form and the library's Send button) land there, so a hidden button or a filtered list is never the only thing standing between a clinic and a link, and a form drawn before a plan change is refused when it is sent.
- **The lists are filtered in the query, not after.** `listUsableVideosInCategory()` (the category page) and `listUsableVideos()` (the `/admin/links` procedure picker) apply the same four conditions in the database, so an off-plan video's address never leaves the server. The library home and the category page decide their state with `categoryState()` from `countPublishedVideosByKind()`, one query for every category.
- **Issued patient links are not governed by this.** See "Nothing breaks while the library fills up": a link keeps working after its category leaves the plan, after a payment lapse or a pause, until its own expiry, its cancellation, or the video being unpublished. `app/watch` and its first-play handler read no clinic plan, on purpose. Permanent QR codes, when they exist, are checked at the moment they mint a new link, through the same `createShare()`.

---

## Nothing breaks while the library fills up

Finished animations arrive slowly and placeholders stand in until they do, while clinics use the app the whole time. Every change has to be safe to ship with the library half full.

- **A migration only adds.** Every new column has a default or is optional. Never delete or rename.
- **Anything shown to a person has a fallback for when its data is missing.** No logo: show the clinic name. No poster: the branded fallback. No Mux id: the CDN file.
- **The catalogue is edited at `/pulse/videos`; the seed scripts are for a fresh database only.** Adding a video, publishing it, replacing a placeholder with the finished file, setting a poster: all of it happens on that page, through `createVideo()` and `updateVideo()` in `lib/db/videos.ts`. `prisma/seed-video.ts` and `prisma/seed-placeholders.ts` still work, but they write the address, length and published flag back to what they hold, so never run them on a database that is in use.
- **Replacing an animation is an edit to the same `Video` row, never a new row**, so every Share and every QR code that points at it keeps working.
- **Unpublishing a video is the one control for withdrawing content, and it stops every link to it, old ones included**: the patient page shows the calm "not available right now" page, views are not counted, `createShare()` refuses new links, and the admin list greys the link and says why. Publishing it again makes them all work again. Nothing else withdraws a video that has already been sent.
- **Patient links already issued outlive the clinic-side changes around them.** Taking a category off a clinic's plan, pausing or closing the clinic, running out of seats, or a category no longer being for sale: none of these cancels a link a patient already has. An issued link follows its own rules only: its expiry, cancellation by the clinic, or the video being unpublished. (The patient page does not check the clinic's status, on purpose.) This policy changes only when a prompt says so in as many words, and any page copy that suggests otherwise is wrong and should be fixed to match.
- **Sale eligibility is about new purchases.** Turning a category's `sellable` switch off, or it having no published video, changes what a new plan may include. It never silently removes a category from a clinic that already has it.
- **A library category is in one of four states for a clinic, decided by `categoryState()` in `lib/access.ts`, and the home tile and the category's own page always agree.** A category with no published video at all is **Coming soon** (a dimmed tile with no link, the same message on its own page, and the category is not offered for sale; the sentence is the category's `comingSoonText` from `CategoryConfig`, or the default). A category with published content that is not on the clinic's plan is **Locked** (a dimmed tile with a padlock and "Not on your plan", the same on its own page, and nothing playable sent to the browser, even when the address is typed). A category on the plan whose only published videos are placeholders this clinic is not shown is **Nothing yet** (an honest empty state, not "coming soon"). Otherwise it is available, with the count of what this clinic is shown. A category is offered for sale only while its `sellable` switch is on; `listSellableCategories()` in `lib/db/category-config.ts` is the one list billing and the plan screens should offer, and whether a category is for sale plays no part in the four states.
- **A placeholder video carries its mark everywhere it appears**: the library card, the player, the Send result, the printed pamphlet, the patient page, the admin lists, and any surface added later. Swapping in the real file is an edit to the same row, never a new row, so share links and QR codes keep working. Unticking "Placeholder" on `/pulse/videos` asks for a yes first, because links already sent start playing the new file at once.
- **A video with a `posterUrl` shows it on the library card**; without one, the card shows the video's own first frame, and the branded fallback if that cannot load.
- **Settings come from `getSettings()` in `lib/db/settings.ts`, never constants.** Expiry days and limits are one AppSettings row, read at request time. Prices are not settings: they are pricing versions, read through `getActivePricing()` (see Pricing shape). `getSettings()` returns the code defaults when the row does not exist, so nothing depends on it having been saved. A clinic can carry its own override for a setting (`Clinic.viewDaysOverride` today); read the clinic's value first, then the platform's. Never put one of these numbers in a page or a constant. The expiry numbers are read when a link is made and copied onto it (`getShareTerms()` and `createShare()` in `lib/db/shares.ts` resolve them the same way), so a settings edit changes links made from then on and never a link a patient already has; see "How a link expires". **A save and a link being made never cross:** `createShare()` reads the settings inside its own transaction through `lockSettings()`, which holds the settings lock shared, and `saveSettings()` takes the same lock exclusively, so a save either landed before the link read the settings or waits until the link is written. Any future write to the settings row goes through `saveSettings()` for that reason.
- **Access is decided in one function each, on the server, and every mutation rechecks it.** Whether a clinic may use the app at all: `clinicIsOpen(clinic)` in `lib/clinic-status.ts`, which reads the clinic's status and its grace deadline: ACTIVE is open, PAST_DUE is open until the exact moment `graceEndsAt` (and closed when no deadline is stored), everything else is closed. The library, `createShare()` and, later, QR issuance all reach it (the last two through the access rule), so they cannot disagree. Whether a person is an admin: `isClinicAdmin()`. What a clinic may use, and whether it may use one video: `getClinicAccess()` and `canUseVideo()` in `lib/db/access.ts`, both answering with the rule in `lib/access.ts` (see Category entitlements). Whether someone can open `/pulse`: `isPulseStaff()`. Pages call these and never re-implement any check, and a Server Action calls the same function again rather than trusting that the page did.

---

## Stack

| Layer | What we use | Notes |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript + Tailwind** | Server Components by default. Add `"use client"` only when a component genuinely needs browser interactivity. |
| Hosting | **Vercel** | |
| Database | **Neon** (PostgreSQL) | |
| Data access | **Prisma 6**, behind `lib/db` | Server-side only. See rule 1. Production is migrated with `prisma migrate deploy` and nothing else (rule 3). |
| Video | **the existing Webflow CDN URL** in Phase 1 | Read it through `getPlaybackUrl()`. See below. |
| Logins | **Clerk** (`@clerk/nextjs`) | Staff only. See Auth below. |
| Tests | **Vitest**, against a Neon branch called `testing` | `npm test`. See Tests below. |
| Payments | **Stripe** (the `stripe` package), **test mode only** | Only `lib/stripe.ts` talks to it, and it refuses any key that is not a test key. Card details are entered on Stripe's own page, never here. See "Billing state" and "Self-serve checkout". |

### Auth

Clerk guards the staff surfaces. The patient surface is never behind it.

- **`/admin`, `/library`, `/pulse` and `/onboarding`, and everything under them, need a signed-in user.** `/watch`, `/q`, `/api/webhooks`, `/sign-in`, `/sign-up` and static files are always public. The list of guarded prefixes lives in `proxy.ts` (Next.js 16's name for the middleware file).
- **`proxy.ts` is a convenience, not the security boundary.** It sends signed-out visitors to `/sign-in` and back again. Clerk's guidance is that every page, Server Action and Route Handler that reads protected data checks for itself, so: staff pages call `requireClinicPage()` first (which calls `await auth.protect()`); actions and handlers rely on `getCurrentClinicId()` returning null. Keep both layers.
- **A clinic is a Clerk organization, and the Clinic row is created on first use.** `getCurrentClinic()` in `lib/clinic.ts` reads the signed-in user's membership in their active organization from Clerk (one call per request, cached), then upserts the Clinic row keyed on `clerkOrgId` (`upsertClinicForClerkOrg()` in `lib/db/clinics.ts`): the first visit creates it with status PENDING and records the organization's creator (Clerk's `createdBy`) as the account owner, later visits copy a changed name or logo and never touch the owner. No webhooks. It is the only place the signed-in user meets the database. **A Clerk organization id (`org_...`) is not a clinic id** and must never be passed to a `lib/db` function that takes a `clinicId`.
- **`requireClinicPage()` is what every staff page calls first.** Signed out goes to `/sign-in`; no organization goes to `/onboarding` (Clerk's CreateOrganization form, or the list of organizations they were invited to). A new clinic's creator is sent from there to `/admin/billing`; someone who joined by invitation goes to `/library`. (`/onboarding/kind`, the retired surgeon question, only redirects to `/onboarding`.) It returns the clinic (id, name, status, logoUrl, isOwner, isAdmin). Each page then checks `clinicIsOpen(clinic.status)` and shows `<ClinicClosed />` if not (with `billingLink` for an admin, on the library as on the admin pages, so an admin is always one tap from Billing); admin pages also check `clinic.isAdmin` and show `<AdminsOnly />` if not. Never crash, never a blank page. **The exception is `/admin/billing`**: an admin of a closed clinic must reach it, so it checks `isAdmin` but not `clinicIsOpen` (see the four surfaces).
- **`getCurrentClinicId()` is for Server Actions and Route Handlers.** A database lookup, no call to Clerk. It returns the clinic id only when the clinic is open, otherwise null, and actions return a plain message on null. A billing action has to work for a closed clinic, so it has its own lookup, `getBillingClinicId()`, which checks the admin role and skips the open check; only the actions under `app/admin/billing` may use it, and it must never be used to loosen anything else.
- **`/api/webhooks/stripe` has no sign-in at all, on purpose.** Stripe's signature over the exact bytes it sent stands in for one (`verifyWebhook()` in `lib/stripe.ts`), and nothing is read, stored or done before it has been checked.
- **`npm run db:link-clinic -- <clinicId> <orgId>`** still exists for a clinic created before its organization (the test clinic was). Clinics that sign themselves up never need it.
- **`CLINIC_ID` is retired.** Nothing reads it. Remove it from `.env` and from Vercel.
- **Clerk's provider wraps only the staff side** (`StaffClerkProvider` in the layouts of `app/library`, `app/admin`, `app/onboarding`, `app/sign-in` and `app/sign-up`). Never put it in the root layout: that would load Clerk's script on every patient's phone. `auth()` on the server works without it.
- The sign-in and sign-up paths, `/sign-in` and `/sign-up`, are set in code in three places that must agree: `proxy.ts`, `StaffClerkProvider` and the `<SignIn path>` / `<SignUp path>` props. No `NEXT_PUBLIC_CLERK_*_URL` variables are used. After signing up or in with no page asked for, `StaffClerkProvider` sends people to `/onboarding` (`signUpFallbackRedirectUrl`, `signInFallbackRedirectUrl`), which routes them: the creator of an unpaid clinic to Billing, everyone else to the library. The root address `/` redirects to `/onboarding` too (never straight to the library), so someone who opened the root, was sent to sign up, and is brought back to the address they asked for, is routed the same way. Anyone who still lands on the library's closed-clinic page gets a Go to billing button if they are an admin (a member is told to ask one). Invitations sent from `/admin/people` carry this deployment's `/sign-up` as their return address (from `pickTrustedOrigin()`, never the browser), so the email's link comes back to our pages rather than Clerk's hosted ones; `/sign-up` hands a person who already has an account (`__clerk_status=sign_in`) to `/sign-in` with the invitation ticket unchanged.
- Clerk dashboard settings this depends on: Organizations enabled, and "Allow users to create organizations" on (so a new sign-up can set up a clinic).
- Clerk treats a session that still has a task to finish (such as choosing an organization) as signed out. The prebuilt `<SignIn />` component walks the user through that step itself.
- Keys: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, in `.env` and in Vercel (Production and Preview). Rule 7 applies. Stripe's two (`STRIPE_SECRET_KEY`, a test key, and `STRIPE_WEBHOOK_SECRET`) live the same way; with neither set the app runs as before and the webhook answers "not configured". Two more that are settings, not secrets: `BILLING_CHECKOUT` (`"test"` opens test-mode checkout, for Preview and a developer's computer only; it is ignored on the production deployment) and the optional `APP_ORIGINS` (a custom domain Stripe may send people back to).

### Roles

Every person in a clinic has a **permission** (their role), and holds a **seat** or waits for one. They are separate things and stay separate. One person, the **account owner**, is special on both counts.

**Permission is the Clerk organization role.** Clerk's free plan has exactly two roles and we use only those (custom roles are a paid add-on). The People page calls them by plain names:

| Role | On the People page | Can |
|---|---|---|
| `org:admin` | Member with admin | `/admin` and everything under it: share links, cancelling any link, QR codes and pamphlets, `/admin/people` (invite, revoke, admin on or off, remove, give a seat), branding and billing. Plus everything a member can do. |
| `org:member` | Member | `/library`, and sending links to patients from it. |

**Admin is a switch an admin flips for someone else**, on `/admin/people` (`setAdmin()` in `lib/seat-changes.ts`). A person cannot turn admin on for themselves (only an admin can call it), switching it never changes the seat count, and the last admin cannot be made a plain member.

**The account owner** (`Clinic.ownerClerkUserId`, a Clerk user id) is the one person who runs the clinic's account. Exactly one per clinic: whoever created the clinic's Clerk organization, recorded when the clinic's row is first made. The owner:

- is always an admin, and cannot have admin switched off or be removed on our screens while they are owner. They hand the account over first;
- is the only person who does not need a seat, and may take one or give it up on `/admin/people` (a solo surgeon buys one seat and takes it; an office manager who buys five gives all five to others). Nobody else decides that for them;
- hands the account over on `/admin/people` to someone who already has admin on, after a popup (`handOffOwner()`). The free spot moves with it (decided by Evan on 2026-09-25): if the new owner holds a seat and the old owner does not, the seat passes to the old owner in the same transaction as the owner change (`setClinicOwner()`), so the count is unchanged and nobody waits. If the new owner has no seat to pass on, the old owner, who stays in the clinic, needs one like everyone else (a free one, or waiting). Pulse staff setting a new owner does the same when the old owner is still in the clinic. The handoff is checked again under the clinic's row lock, so two tabs handing over at once end with one owner and one log entry.

Clerk's own panel can still let someone leave or be removed. When the seat check finds the owner is no longer a member it clears the owner and logs it; `/pulse` then flags the clinic "No account owner" (so is every clinic made before owners existed), and Pulse staff set a new one from the clinic's People tab (`setOwnerByStaff()`, which switches admin on for them if needed, logged under the staff member's name). If the owner's admin is switched off in Clerk's panel, `/admin/people` and `/pulse` say so.

**The seat** is described under "Surgeon seats". **A seat never grants a permission**, and a role never takes a seat away.

**Check permission on the server, in every page and every action**, with `isClinicAdmin()` from `lib/roles.ts` (which uses Clerk's `has({ role })`). Hiding a button or an icon is a courtesy, never the check. A member who opens `/admin` sees "This page is for your clinic's office admins."

The helpers live in `lib/roles.ts` (`isClinicAdmin()`, server only), `lib/role-names.ts` (the two roles and their words, safe for the browser), `lib/people.ts` (the people and invitations in a clinic, read from and written to Clerk; it never touches `lib/db`) and `lib/seat-changes.ts` (the only way anyone's seat, role, invitation or ownership is changed).

### The video boundary

Never read `video.videoUrl` directly in a page. Always go through:

```ts
// lib/video.ts
export function getPlaybackUrl(video: Video): string
```

Phase 1 returns the stored URL. Phase 2 returns a signed, expiring URL from Mux or Cloudflare Stream. **One function changes and no page changes.**

**Be honest about what that protects.** Today the CDN address is public and permanent, so a share link's expiry limits the page, not the file: never describe the media as protected, in copy or in a PR, until signed playback ships. And even then, a signed or expiring address restricts who can start a new play; it does not stop screenshots or screen recording, does not stop every form of copying, and does not pull back a video that a phone has already buffered. Say so wherever the question comes up.

---

## The database

Twelve models and ten enums. If a task seems to need a thirteenth model, stop and ask.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // pooled connection, used by the app
  directUrl = env("DIRECT_URL")     // direct connection, used by migrations
}

enum Category {
  SPINE
  COMPLEX_SPINE
  KNEE
  SHOULDER
  HIP
  FOOT_ANKLE
}

/// Pulse 3D's own library. Not owned by any clinic.
model Video {
  id              String   @id @default(cuid())
  title           String                        // "Total Knee Replacement"
  category        Category
  videoUrl        String                        // read via getPlaybackUrl(), never directly
  durationSeconds Int?
  isPublished     Boolean  @default(false)      // staging: Van finishes animations before they go live
  isPlaceholder   Boolean  @default(false)      // a sample animation stands in for this procedure. Shown, but marked everywhere it appears. Not the same as isPublished.
  posterUrl       String?                       // a still shown on the library card instead of the video's own first frame; empty means the branded fallback
  notes           String?                       // internal, for Pulse staff on /pulse/videos: what the file is, what is still to do. Never shown to a clinic
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  shares          Share[]

  @@index([category])
}

/// One row per library category: whether it is offered for sale, and the
/// sentence the library shows while it has nothing published. Rows are made
/// on first read with the defaults (getCategoryConfigs() in
/// lib/db/category-config.ts), so a category with no row behaves like one
/// that was never touched: for sale, default sentence.
model CategoryConfig {
  category       Category @id
  sellable       Boolean  @default(true)       // false takes the category off the price list; it still shows in the library
  comingSoonText String?                       // shown on the library's "Coming soon" tile while the category has no published video
}

/// Where a clinic stands with us. Only ACTIVE clinics can use the library
/// (see clinicIsOpen() in lib/clinic-status.ts). New clinics start PENDING
/// until they choose a plan; the other states come with billing.
enum ClinicStatus {
  PENDING
  ACTIVE
  PAUSED
  PAST_DUE
  CANCELED
}

/// A customer practice. One row per Clerk organization: the row is created
/// the first time someone from that organization signs in (lib/clinic.ts).
model Clinic {
  id         String       @id @default(cuid())
  name       String                             // copied from the Clerk organization's name; used for the on-video watermark
  clerkOrgId String?      @unique               // the Clerk organization its staff sign in with
  status     ClinicStatus @default(PENDING)     // the EFFECTIVE status, never set on its own: worked out by effectiveAccess() from staffAccess, managedByPulse and the ClinicBilling row, and rewritten whenever one of them changes
  logoUrl    String?                            // copied from the Clerk organization's logo, when it has one; Pulse staff can set one too
  createdAt  DateTime     @default(now())

  // Set by Pulse staff on /pulse. Nothing here is shown to the clinic except
  // noticeText (top of its /admin) and the effect of showPlaceholders and
  // viewDaysOverride.
  managedByPulse   Boolean    @default(false)   // enterprise or comped: billing screens hidden, plan edited by Pulse
  statusReason     String?                      // why staff set the status by hand
  statusChangedBy  String?                      // who last changed the status: a staff name, or "billing" later
  statusChangedAt  DateTime?                    // when the status was last changed
  notes            String?                      // the old single notes box. Superseded by ClinicNote; kept, never read (rule 4)
  noticeText       String?                      // a line shown at the top of that clinic's /admin
  showPlaceholders Boolean    @default(true)    // false hides placeholder videos from this clinic's library
  viewDaysOverride Int?                         // days a patient link works after the first play, instead of AppSettings.viewDays; copied onto each new link when it is made
  phone            String?                      // the clinic's phone, stored as digits only; see lib/phone.ts
  categories       Category[] @default([])      // the categories on the clinic's plan; empty means none yet
  surgeonSeats     Int        @default(0)       // surgeon seats the clinic pays for
  brandColor       String?                      // optional brand colour; derived shades preserve contrast
  brandFont        String?                      // approved font key; null uses Inter
  brandTheme       String?                      // "light" for light staff screens; null or "dark" means dark. Checked by parseBrandTheme(); the patient page and /pulse ignore it
  shares           Share[]
  clinicNotes      ClinicNote[]

  // The pricing version this clinic is pinned to, once it has a subscription
  // (billing sets it). Empty means the active version. Activating a new
  // version never changes a pin: a clinic keeps the prices it signed up at.
  pricingVersionId String?
  pricingVersion   PricingVersion? @relation(fields: [pricingVersionId], references: [id], onDelete: Restrict) // a pinned version cannot be deleted; a pin is never silently lost

  // Billing. See "Billing state" below.
  practiceType PracticeType @default(UNKNOWN)   // a hospital is always Enterprise and never pays by card; set only by Pulse staff. UNKNOWN counts as a clinic (decided 2026-09-25)
  staffAccess  StaffAccess?                     // what Pulse staff set by hand, which always wins over billing; empty means billing decides. Who, why and when are statusChangedBy, statusReason, statusChangedAt
  graceEndsAt  DateTime?                        // only while status is PAST_DUE: the exact moment the clinic closes. Copied from ClinicBilling.graceEndsAt; empty with PAST_DUE means closed
  billing      ClinicBilling?
  billingPlans BillingPlan[]

  // Who holds one of the seats above, and which open invitations hold one. See "Surgeon seats" below.
  seatAllocations SeatAllocation[]
  seatInvitations SeatInvitation[]

  // The account owner's Clerk user id: always an admin, the one person who
  // needs no seat. Set when the clinic is created, moved by a handoff or by
  // Pulse staff, cleared when the owner leaves. Empty for clinics made before
  // owners existed. See "Roles".
  ownerClerkUserId String?
}

/// From the owner model on, every new seat is SYNCED; PENDING is only found on
/// rows the earlier model wrote, and the seat check marks those SYNCED.
enum SeatSyncState {
  PENDING
  SYNCED
}

/// One seat, held by one person at one clinic. With SeatInvitation, THE
/// AUTHORITY on who holds a paid seat. A row is only ever added inside a
/// transaction that holds the clinic's row lock. Two ids and nothing about
/// the person: no name, no email, no role.
model SeatAllocation {
  id          String        @id @default(cuid())
  clinicId    String                              // the tenant column. Always filter by it.
  clinic      Clinic        @relation(fields: [clinicId], references: [id], onDelete: Cascade)
  clerkUserId String                              // the Clerk user id of the person holding the seat. An id only
  syncState   SeatSyncState @default(PENDING)
  reservedAt  DateTime      @default(now())       // when the seat was given
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  @@unique([clinicId, clerkUserId])               // one seat per person per clinic, which is also what makes a repeated request harmless
}

/// One seat held by an invitation not yet accepted. Counts against the plan
/// like a SeatAllocation row and is written under the same lock. The Clerk
/// invitation carries this row's id ({ seatHold: id }); Clerk copies it onto
/// the membership on acceptance, and the seat check turns the hold into the
/// person's seat. Ids only: the email lives in Clerk.
model SeatInvitation {
  id                String   @id @default(cuid())
  clinicId          String                         // the tenant column. Always filter by it.
  clinic            Clinic   @relation(fields: [clinicId], references: [id], onDelete: Cascade)
  clerkInvitationId String?  @unique               // Clerk's invitation id, set once Clerk has made it
  reservedAt        DateTime @default(now())       // a hold Clerk never made an invitation for is let go after a few minutes
  createdAt         DateTime @default(now())

  @@index([clinicId])
}

enum PracticeType {
  UNKNOWN   // not answered yet: every clinic starts here, including every clinic that existed before billing
  CLINIC    // may pay by card
  HOSPITAL  // always Enterprise, set up by Pulse, never self-serve
}

/// What Pulse staff set by hand. It always wins over what billing says.
enum StaffAccess {
  OPEN      // opened by hand (how every clinic was switched on before billing)
  PAUSED
  CANCELED
}

/// Where a clinic's card subscription stands, as Stripe reports it. The
/// financial record only; whether the clinic is open is Clinic.status.
enum BillingStatus {
  NONE        // no subscription
  INCOMPLETE  // checkout started, first payment not confirmed. No access comes from this
  ACTIVE      // paid
  PAST_DUE    // a renewal failed; grace runs from the first time this was recorded
  CANCELED    // ended
}

enum BillingInterval {
  MONTH
  YEAR
}

/// Stripe's side of one clinic. One row per clinic, made when it first starts
/// a checkout. Written only by lib/db/billing.ts, under the clinic's row lock.
model ClinicBilling {
  clinicId             String        @id
  clinic               Clinic        @relation(fields: [clinicId], references: [id])
  stripeCustomerId     String?       @unique     // set once, before a checkout is started; never changed
  stripeSubscriptionId String?       @unique     // the ONE subscription this clinic is expected to have. News about any other is ignored
  status               BillingStatus @default(NONE)
  currentPeriodEnd     DateTime?
  cancelAt             DateTime?                 // set while a cancellation is scheduled: the subscription stays active until then
  paymentFailedAt      DateTime?                 // when the failed renewal was first recorded. Set once
  graceEndsAt          DateTime?                 // paymentFailedAt plus the grace days in the settings at that moment. Fixed once; cleared on recovery
  lastReconciledAt     DateTime?
  pendingPlanId        String?       @unique     // accepted at checkout, waiting for the first payment
  currentPlanId        String?       @unique     // in force
  scheduledPlanId      String?       @unique     // takes over at scheduledChangeAt. Nothing sets it until plan changes are built (rule 4)
  scheduledChangeAt    DateTime?
  // (the three plan ids are relations to BillingPlan, onDelete: Restrict)
  createdAt            DateTime      @default(now())
  updatedAt            DateTime      @updatedAt
}

/// One plan a clinic accepted. Written once and never edited.
model BillingPlan {
  id                 String          @id @default(cuid())
  clinicId           String
  pricingVersionId   String                      // the version it was quoted from; Restrict, so that version can never be deleted
  categories         Category[]                  // what the clinic picked
  entitledCategories Category[]                  // what it gets (every category when the full library is included)
  surgeonSeats       Int
  interval           BillingInterval
  perSeatCents       Int                         // from the pricing engine: the unit price Stripe is given
  totalCents         Int
  acceptedById       String
  acceptedByName     String
  createdAt          DateTime        @default(now())

  @@index([clinicId, createdAt])
}

enum BillingEventStatus {
  RECEIVED   // written down, work not finished
  PROCESSED  // done and committed
  IGNORED    // nothing to do, on purpose
  FAILED     // the work threw; Stripe was told to send it again
}

/// One row per Stripe event id. The unique constraint is what makes a
/// repeated delivery harmless. The body Stripe sent is never stored.
model BillingEvent {
  id                   String             @id @default(cuid())
  stripeEventId        String             @unique
  type                 String
  clinicId             String?            // not a relation: an event can arrive for a customer we do not know
  stripeCustomerId     String?
  stripeSubscriptionId String?
  status               BillingEventStatus @default(RECEIVED)
  outcome              String?            // one plain sentence
  attempts             Int                @default(0)
  lastErrorCode        String?            // the KIND of error only, never a message
  receivedAt           DateTime           @default(now())
  processedAt          DateTime?

  @@index([status, receivedAt])
  @@index([clinicId, receivedAt])
}

/// One saved set of prices (see lib/pricing.ts for the shape). Versions are
/// only ever added: a config is never edited after it is saved, so a clinic
/// pinned to version 3 keeps exactly the prices version 3 held. At most one
/// version is active, and it is what new quotes use.
model PricingVersion {
  id            String   @id @default(cuid())
  version       Int      @unique @default(autoincrement()) // 1, 2, 3, handed out by the database, so two saves at once cannot share a number
  config        Json     // a PricingConfig, validated before it is saved and again when it is read
  note          String   // what changed and why, written by the staff member who saved it
  createdAt     DateTime @default(now())
  createdBy     String   // the Clerk user id of the staff member who saved it
  createdByName String   // their name, for the history list
  // true for the active version, null for every other one, never false. The
  // unique constraint is what guarantees a single active version: only one
  // row can hold true, while any number of rows can be empty.
  active        Boolean? @unique
  clinics       Clinic[]
  billingPlans  BillingPlan[]   // the accepted plans quoted from this version
}

/// What kind of entry a clinic note is: typed by a staff member, or written
/// by the app when something changed (any change saved on /pulse today; billing later).
enum NoteKind {
  STAFF  // typed by a staff member
  STATUS // written by the app when a change was saved on /pulse: status, plan, details, managed by Pulse. Named for the first such change; shown as "Change"
}

/// The running log on a clinic's /pulse page. Append-only: entries are never
/// edited or deleted, so it reads as a history. Internal, never shown to
/// the clinic.
model ClinicNote {
  id         String   @id @default(cuid())
  clinicId   String
  clinic     Clinic   @relation(fields: [clinicId], references: [id], onDelete: Cascade)
  kind       NoteKind @default(STAFF)
  body       String
  authorName String                              // the staff member's name, or "billing" and the like for app-written entries
  createdAt  DateTime @default(now())

  @@index([clinicId, createdAt])
}

/// Platform-wide settings. Exactly one row, with id "default". Read through
/// getSettings() in lib/db/settings.ts, which returns these defaults when the
/// row does not exist yet, so nothing depends on it having been created.
model AppSettings {
  id            String   @id @default("default")
  unclaimedDays Int      @default(90)   // days a patient link works if nobody ever plays it
  viewDays      Int      @default(7)    // days a patient link keeps working after the first play; copied onto each new link as Share.daysAfterFirstPlay
  graceDays     Int      @default(14)   // days a clinic keeps access after a missed payment
  qrDailyFlag   Int      @default(200)  // scans of one QR code in a day that get flagged for a look
  updatedAt     DateTime @updatedAt
}

/// How a share link's expiry date is worked out (see lib/expiry.ts).
///   FIXED       the Phase 1 rule: expiresAt was set when the link was made
///               and never moves, played or not. Every link made before the
///               first-play rule shipped is FIXED, and so is any link an
///               older copy of the app makes, because FIXED is the database
///               default. Their dates are never changed.
///   FIRST_PLAY  the rule from September 2026 on: the link stops after
///               unclaimedDays if nobody plays it, and the first real play
///               moves expiresAt to that moment plus daysAfterFirstPlay.
enum ExpiryPolicy {
  FIXED
  FIRST_PLAY
}

model Share {
  id           String    @id @default(cuid())
  code         String    @unique                // short random string in the URL, e.g. k7m2xq
  clinicId     String                           // the tenant column. Always filter by it.
  clinic       Clinic    @relation(fields: [clinicId], references: [id])
  videoId      String
  video        Video     @relation(fields: [videoId], references: [id])
  expiresAt    DateTime                         // when the link stops working. Under FIRST_PLAY it moves once, at the first play
  createdAt    DateTime  @default(now())
  viewCount    Int       @default(0)            // play starts on the patient page: one per page load, the first time the video actually plays
  lastViewedAt DateTime?

  // The expiry rule this link was made under, and what it needs (see the enum above).
  expiryPolicy       ExpiryPolicy @default(FIXED) // FIXED by default so a link written without it (older code, a hand insert) is a legacy link
  firstPlayedAt      DateTime?                    // set once, by the first real play of a FIRST_PLAY link; the deadline moved at that moment and never again
  daysAfterFirstPlay Int?                         // copied from the settings (the clinic's override, else the platform's viewDays) when the link was made, so a later settings edit never changes a link already issued

  @@index([clinicId])
}
```

**Why `Clinic` existed in Phase 1 when there was only one of them.** Adding a tenant column to a table that already holds real customer data is a migration plus a hunt through every query for the ones that forgot to filter. Adding it early cost one table and one column. This is the single most important scale decision in the project.

**Clinic status.** A clinic is created PENDING. `Clinic.status` is the clinic's **effective** status and is never written on its own: it is worked out from what staff set by hand, whether Pulse manages the clinic, and its billing record (see "Billing state"), and rewritten in the same transaction as whichever of those changed. Pulse staff open, pause or cancel a clinic by hand from its page on `/pulse`, or with `npm run db:set-status -- <clinicId> ACTIVE` (also PAUSED, CANCELED, or FOLLOW to remove the hand setting); both go through `setClinicStatusByStaff()`. Never change a status by hand in Neon. A closed clinic's issued patient links keep working until they expire (see "Nothing breaks while the library fills up").

### Billing state

Stripe, in **test mode only**. `lib/stripe.ts` is the only file that talks to Stripe and it refuses any key that does not start with `sk_test_` or `rk_test_`; a live-mode notification is refused too. Going live is a deliberate, reviewed change to that file, never a value pasted into Vercel. This section is the state underneath checkout; "Self-serve checkout", after it, is how a clinic gets a subscription in the first place.

**Two things are kept apart.** The **financial record** (`ClinicBilling`) is what Stripe says about the clinic's one expected subscription; it is brought up to date from Stripe whatever else is true, so it can always be checked against Stripe. **Access** (`Clinic.status`, `Clinic.graceEndsAt`) is worked out by `effectiveAccess()` in `lib/billing-state.ts` from three inputs. The state table, first rule that fits wins:

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

- **What staff set by hand always wins.** No notification, old or new, reopens a clinic staff paused; billing never writes `staffAccess` to PAUSED, CANCELED or OPEN. Who, why and when are stored with it, and removing it ("Follow billing") hands the clinic back to its billing record. **One automatic change exists (decided while building, flagged for Evan):** when a self-serve clinic's first card payment is confirmed, a hand setting of OPEN is cleared, with a log entry, so a clinic opened by hand before billing follows its payments from then on. PAUSED and CANCELED are never cleared by anything but staff.
- **A Pulse-managed clinic keeps the plan and access staff gave it.** Billing news still updates its financial record and is still logged, but changes neither. Turning managed ON for a clinic that is open keeps it open (it is given OPEN in the same write).
- **Pausing, cancelling or marking a clinic managed does NOT cancel anything in Stripe.** A card subscription keeps charging until it is cancelled in Stripe, and every screen, script and log line that does one of those says so. Never describe hiding billing as stopping charges.
- **The webhook never applies what a notification says.** `POST /api/webhooks/stripe` checks the signature over the raw body, then `handleStripeEvent()` (`lib/billing-events.ts`) writes the notification down under Stripe's event id (insert first, catch the unique refusal: a repeat finds the row and, if it is finished, nothing at all is done), takes only the customer id and subscription id from its body, finds the clinic by the customer, and calls `reconcileSubscription()` (`lib/db/billing.ts`). That locks the clinic's row (the same lock every staff change takes), asks Stripe where the subscription stands **now**, and applies that with `decideBilling()`, writing the record, the plan, the status, one log entry and the notification's "finished" mark in **one transaction**. So order, lateness and repeats do not matter, two notifications (or a notification and a staff pause) happen one after the other, and "finished" is never true of work that did not commit. Event time and arrival order are never used to decide freshness.
- **Whose subscription it is.** The subscription Stripe returns must belong to the clinic's own Stripe customer (set once, by `setStripeCustomer()`, before checkout creates anything). Only the expected subscription is applied. A different one may take over only when the expected one is over or never started, it carries the id of the plan the clinic accepted and is waiting on (`metadata.billingPlanId` on the **subscription itself**, which checkout must put there: session metadata does not appear on subscription events), and it is not already dead. News of an old cancelled subscription therefore cannot touch its replacement. A second live subscription changes nothing and is flagged for a person ("Needs a look"). So is any subscription on the clinic's own customer that is being **charged** and is not the plan the clinic accepted last (an earlier attempt's page paid after a newer one was started): nothing is changed, because what it bought cannot be known from here, but a person has to look. An unrecognised subscription nobody is paying for is noise and is not flagged. **A never-paid subscription that dies (it expired, or was cancelled before paying) clears the waiting plan only when it carried that very plan**: if the admin has started again since, the newer plan stays waiting, or the new checkout would be paid and then not recognised.
- **Payment is never inferred.** Not from a redirect, not from checkout completing, not from Stripe's word "active" alone: the first activation, and a recovery from PAST_DUE, both need the subscription's latest invoice to be **paid** (Stripe also says "active" when an invoice is written off). A failed **first** payment leaves the subscription INCOMPLETE: no grace, no access. No trial and no second payment method exists; a trialing or paused subscription changes nothing and is flagged.
- **Grace.** Starts once, at the server's time when the failed renewal is first recorded (a late notification can only give a clinic more time, never less). The deadline is that moment plus the grace days setting as it was then (1 to 365; `graceDeadline()`), fixed: repeated failures never move it. It is cleared by a confirmed recovery. At the deadline itself the clinic is closed; no job has to run, because `clinicIsOpen()` compares the stored deadline with the server's clock on every request. A setting or a deadline that cannot be read means **no** grace, never unlimited.
- **A failure is retried, never lost.** When the work throws, everything rolls back, the notification is marked FAILED with the kind of error only, and the route answers 500 so Stripe sends it again. Staff can also press Try again on `/pulse/billing`. The work is awaited before answering: nothing runs in the background after the response.
- **Accepted plans are immutable.** `acceptPlanForCheckout()` (checkout's writer; `recordAcceptedPlan()` is the plain one) writes a `BillingPlan` row (amounts from the pricing engine on the server, checked again here) and points `pendingPlanId` at it; the first confirmed payment makes it the current plan and, for a self-serve clinic, copies its entitled categories, seats and pricing version onto the clinic. It is refused while a subscription is live: changing a paid plan is a later step. It is also refused with fewer seats than are taken right now, by people and open invitations (see "Surgeon seats").
- **Who may pay by card** is `selfServeEligibility()`: a clinic that is not a hospital, is not managed by Pulse, and has not been paused or ended by Pulse staff by hand (what staff set wins over billing, so its payment would be taken and it would stay closed; it talks to Pulse first). UNKNOWN, where every clinic starts, counts as a clinic. **Decided by Evan on 2026-09-25**, after the Prompt 3 preview test: the "clinic or hospital?" question was dropped from `/admin/billing`, because the seat limit already sends big practices to Pulse. The trade-off, accepted: a small hospital within the seat limit can pay by card without talking to Pulse first, unless Pulse staff have marked it a hospital. A hospital never may pay by card, and only Pulse staff can mark one, on the clinic's `/pulse` page, logged like every other change there; a clinic cannot set its own practice type, and a `practiceType` field in any clinic-side form is never read. No rows were changed: UNKNOWN rows stay UNKNOWN and simply count as clinics. A clinic staff are holding OPEN may pay; its first confirmed payment hands its access over to its payments. The seat limit is separate and also enforced on the server: more seats than the active version's Clinic maximum is Enterprise, quoted with no amount, and refused.
- **Issued patient links are untouched by all of this**, as always.
- To try it against real Stripe test mode on your own computer: put a test key and `BILLING_CHECKOUT="test"` in `.env`, run `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, and put the signing secret it prints in `STRIPE_WEBHOOK_SECRET`. Without the Stripe CLI the purchase still completes at Stripe, and "Check again" on the return page brings the clinic into line.

### Surgeon seats

**The model (decided by Evan and Van on 2026-09-21, replacing the surgeon-or-staff model of PR #28):** everyone in a clinic except the account owner holds one of the seats its plan pays for (`Clinic.surgeonSeats`), and an open invitation holds one too. There is no free "staff" kind any more and no surgeon question. Every plan has at least one seat (checkout refuses zero: `readPlanSelection()`, `quote()` and `acceptPlanForCheckout()` all say so), so nobody gets the library by signing up as owner alone. The rules are `lib/seats.ts` (pure); read the top of that file first.

**Our tables are the authority on who holds a seat.** `SeatAllocation` has one row per person holding a seat; `SeatInvitation` has one row per open invitation holding one. Together they are what is compared with the plan. Membership, roles and invitations themselves live in Clerk. A person with no row is **waiting for a seat**, and uses the library exactly as before: a seat is a billing fact, never a permission.

- **A seat is only taken under the clinic's row lock.** `reserveSeat()` (a person) and `holdSeatForInvitation()` (an invitation) in `lib/db/seats.ts` lock the clinic, count people and holds, and only then write (`readSeatsLocked()` in `lib/db/seat-lock.ts` is the lock-then-count). Two requests for the last seat, whether people or invitations or one of each, run one after the other and the second is refused. Lowering a plan takes the same lock. One row per person per clinic makes a repeated request harmless.
- **Invitations are sent from `/admin/people`, never before the clinic is paid for.** Until the clinic is open the page says "Choose a plan first" and the actions refuse (they use `getCurrentClinicId()`, which is null for a closed clinic). `inviteSomeone()` in `lib/seat-changes.ts` holds a seat first, then asks Clerk to send the invitation with the hold's id in its public metadata (`{ seatHold: id }`), then records Clerk's invitation id on the hold. If Clerk refuses, the hold is let go; if the server dies in between, the hold lets itself go after `PENDING_WINDOW_MS` (two minutes), or is linked by the next check if the invitation did go out. An admin can only have as many open invitations as there are free seats. Revoking (`revokeInvitation()`) revokes in Clerk, then frees the hold.
- **An accepted invitation becomes that person's seat.** Clerk copies the invitation's public metadata onto the new membership, so the seat check sees the hold id on the person and turns the hold into their seat in one step, under the lock: the count never changes and nobody else waiting can take it. An invitation made outside our page (Clerk's panel or dashboard) carries no hold: the People page lists it as holding no seat, and its person arrives waiting for one. The Members tab of Clerk's panel is still reachable at the bottom of the page; the page says invitations belong in our section.
- **A database transaction cannot make a call to Clerk part of itself, and nothing pretends it can.** No lock is ever held across a call to Clerk. Every change that writes to Clerk (invite, revoke, remove, admin on or off, making someone owner) is ordered in `lib/seat-changes.ts` so that every way it can stop halfway leaves something harmless that `checkSeats()` puts right. Giving a seat and handing over the owner touch only our database.
- **`lib/seat-changes.ts` is the only place the Clerk writes in `lib/people.ts` may be called from.** A test reads the source tree and fails if anything else uses them, or calls Clerk's membership or invitation writes directly. Every function there looks the clinic's own organization up from the clinic's row and checks with Clerk that the person is a member of **that** organization (or, for an invitation, that it is open in that organization) before anything is written, so an id sent by the browser can never reach into another clinic.
- **Nobody is removed or relabelled to make the numbers fit.** Removing someone is an admin's choice on `/admin/people` (never the owner, never yourself); it frees their seat. People in the clinic before this model (including anyone once marked "staff") are shown as waiting for a seat, and are given one only when one is free. The Clerk `kind` label those people may still carry is ignored.
- **`checkSeats(clinicId)` brings the tables back into line with Clerk** (`planSeatCheck()` decides, `applySeatCheck()` does it under the lock and counts again before each seat it gives). It turns accepted invitations into seats, records invitation ids a failed request left out, lets go the seat of someone who has left, lets go holds whose invitation Clerk says was revoked or expired (asked one by one before any hold is let go; a hold is kept whenever Clerk cannot be asked), gives free seats to people waiting (oldest member first, never the owner), and clears the owner when the owner has left. It never removes anyone, never gives more seats than the plan has, and writes nothing (and logs nothing) when there is nothing to put right. An empty member list from Clerk is treated as "could not say". There are no background jobs and no Clerk webhooks, so it runs when `/admin/people` or a clinic's `/pulse` page is opened, after a handoff, and **before anyone is told a clinic is full**.
- **Seats cannot be lowered below the number taken without saying so.** `checkSeatReduction()` is asked, under the lock, wherever seats can go down: `acceptPlanForCheckout()` and `recordAcceptedPlan()` refuse a plan with fewer seats than are taken, people and open invitations together (this is "when it is scheduled"); `setClinicPlan()` refuses too unless `allowFewerSeatsThanInUse` is set, which the `/pulse` Plan form sends only when the staff member ticked the box that says so (`npm run db:set-plan` has `--allow-fewer-seats`). When a plan **takes effect** short of what is taken (seats can be taken between accepting a plan and paying for it), it is applied, because it was paid for, and `reconcileSubscription()` says so in the log. **When changing a paid plan is built, a seat reduction must ask `checkSeatReduction()` both when it is scheduled and again when it is applied.**
- **An over-the-plan clinic is shown, never quietly fixed.** Nobody is removed, no seat is taken away and no charge is changed. The gap is said in plain words on `/admin/people`, `/admin/billing` and the clinic's `/pulse` page, the log entry says by how much, and `hasFreeSeat()` refuses every new seat and invitation until someone is removed, an invitation revoked, or the seats raised.
- **Seat and owner changes are in the clinic log**, written in the same transaction as the change where the change is ours: a seat given or let go, an invitation sent or revoked, a removal (under "<name> (clinic admin)"), a handoff, an owner set by Pulse staff, and anything `checkSeats()` put right (under "seats"). Admin on or off is logged right after Clerk confirms it. A hold whose invitation was never made is not written up. Nothing about the person is stored but a Clerk id: names appear only in the log's sentences, and invited email addresses live only in Clerk.
- **What this does not do.** A removal, a revocation or an owner leaving in Clerk's own panel is noticed the next time someone opens the People page or the clinic's `/pulse` page, not the instant it happens. And that the metadata really is copied from an invitation to the membership is Clerk's documented behaviour, proved here only with the stand-in: the walkthrough with a real Clerk test organization is the check.

### Self-serve checkout

An admin of an eligible clinic picks categories, surgeon seats and monthly or yearly on `/admin/billing`, sees the total, and is sent to a payment page hosted by Stripe. Card details never touch this app. The flow is `startCheckout()` in `lib/checkout.ts` (server only); its pure rules are `lib/checkout-rules.ts`; everything it asks of Stripe goes through the `CheckoutGateway` in `lib/stripe.ts`. **No schema was added for it:** the `BillingPlan` row from the billing foundation is the durable purchase attempt.

- **Where it is open.** `checkoutIsOpen()` in `lib/stripe.ts`: `BILLING_CHECKOUT` is exactly `"test"`, the key is a test key, **and the deployment is not Vercel's production one**. In test mode a "purchase" is paid with Stripe's public test card, so offering it on the production site would let anyone open a clinic for nothing. Opening checkout to real customers is part of going live, a reviewed change to that function together with the live keys. Where it is shut, the Billing page says plans are not open yet and the action refuses.
- **The server prices it (rule 8).** The form says what was picked and nothing about money that is believed: `readPlanSelection()` reads categories, seats, the interval, and which pricing version and total the admin was *looking at*. A clinic id, an amount, a discount or a founding flag added to the request is never read. The price is worked out from the **active** saved version (an estimate is refused) and the categories for sale right now (`listSellableCategories()`), with `practiceType: "clinic"` once eligibility has been checked (a hospital was refused there, and a clinic never marked counts as a clinic). A category that is not for sale, or is coming soon, is not a purchase option; a plan a clinic already has is never reduced because sale eligibility changed later.
- **Nobody pays a total they did not see.** If the version or the total differs from what was on screen (prices changed while the page was open, or a forged form), nothing is created, the admin is shown the new total, and has to press again. Once an attempt is written, its payment page charges that attempt's amounts even if the active version changes a minute later, and it pins that version when paid. The page stops being payable after `SESSION_MINUTES` (60).
- **One customer, one page, one subscription.** The clinic's Stripe customer is made with an idempotency key built from the clinic id and stored by `setStripeCustomer()` **before** anything else exists in Stripe. The attempt is written by `acceptPlanForCheckout()` under the clinic's row lock, where eligibility and "no live subscription" are checked again and an identical recent attempt is found instead of a second one being written (the clock is read after the lock is held, and a small negative age still counts as recent, or a double click would make two attempts). The payment page is made with an idempotency key built from the attempt's id, so identical requests get the same page. Every other open page of that customer is closed. If a different attempt became the waiting one while this request ran (two tabs, different picks), this request closes its own page and says so. Stripe answers a repeated key with its **first** answer, so for a reused attempt the page's current state is asked for: already paid sends the admin to the return page, closed starts a fresh attempt.
- **What Stripe is asked to charge** is `checkoutSessionParams()`, pure and tested: one line, the engine's per-seat amount for the interval as the unit price and the seats as the quantity. **A yearly plan is a yearly price of the whole year's amount**, never the monthly amount with "year" on it. One fixed product (`PRODUCT_ID`); Stripe generates a Price object for each page, which is fine: our versioned engine is the pricing authority, not Stripe's price list. The only payment method type asked for is `card`, with a fixed quantity, no promotion codes, no trial and no tax. (Stripe's page can still offer the card wallets and Link, including Link's bank option, that are switched on in the Stripe account's own settings; that is a Stripe setting to decide before live payments, and whatever is used, nothing opens until the invoice is paid.) The accepted plan's id goes on the **subscription's own metadata**, the only place the webhook looks.
- **Return addresses are trusted origins.** `pickTrustedOrigin()` in `lib/trusted-origin.ts` uses the request's Host header only to choose among addresses the deployment already knows are its own (Vercel's own variables, the optional `APP_ORIGINS` list, localhost on a developer's computer). With none, checkout is refused. Never build a Stripe return address from `getBaseUrl()`.
- **The return page grants nothing.** `/admin/billing/return` reads the clinic's billing record and says confirmed, confirming, failed or nothing to confirm. Anybody can type its address; it changes no state. While confirming it looks again a fixed number of times and stops; then "Check again" (`checkPayment()`) finds the clinic's own subscription through its own customer id and runs the same `reconcileSubscription()` the webhook runs, which activates only on an active subscription with a paid invoice. It exists because a notification can be late, or unable to reach a deployment at all (a preview behind Vercel's sign-in). It is bounded too, harmless to repeat, and never starts another checkout. An admin who pays and closes the browser loses nothing: the webhook does the work.
- **An existing subscription routes to its plan, not to a second checkout.** A clinic with a live subscription sees the plan it accepted, with the real amounts instead of an estimate, and is refused a new checkout on the server. Changing it, updating a card and cancelling are later steps.
- **Before live payments**, Evan and Van approve: the prices, founding terms, tax, refund and cancellation terms, and the customer-facing wording about recurring charges. The words on the picker today are test-mode placeholders.

**The clinic log.** `ClinicNote` is the history of a clinic as Pulse sees it: notes staff type (kind STAFF), and entries the app writes when something changes (kind STATUS, named for the first such change and shown as "Change"). **Every change staff save on a clinic's page writes an entry: access set by hand, plan, managed by Pulse, practice type, each detail field, and branding (including saves by clinic admins)**, saying what it was and what it became, under the staff member's name. Seats given and let go, invitations sent and revoked, and account owner changes are logged the same way (see "Surgeon seats"). The change and its entry go in one transaction (`changeClinicWithLog()` in `lib/db/clinics.ts`), so the current state and the history cannot disagree, and a save that changes nothing writes nothing. Entries are only ever added. Billing writes the same pair under the name "billing": one entry for each real change to a clinic's subscription, none for a repeated or late notification that changed nothing. If you add a new thing staff can change about a clinic, write it through the same helper so it is logged too. Nothing in the log is ever shown to the clinic.

**Clinic plan.** `Clinic.categories` and `Clinic.surgeonSeats` are the plan. Set on `/pulse` or with `npm run db:set-plan -- <clinicId> --categories all --seats 10`. The categories are enforced: they decide what the library shows and what `createShare()` allows (see Category entitlements). The seats are enforced too: they are how many people may hold a surgeon seat, and lowering them below the number in use needs an explicit override (see Surgeon seats). On the clinic side the plan is shown in one place, `/admin/billing`, read through `getClinicPlan()` (categories, seats, managed by Pulse, and nothing internal). Do not put plan or pricing information on `/admin` (the overview) or `/admin/links`.

**Pricing versions.** Saving on `/pulse/pricing` adds a `PricingVersion` row; nothing ever edits one. Making a version active is the only update the table sees, done in one transaction under the unique constraint on `active`, so two activations at once still end with one active version. The page asks before it does so (the confirmation names the version and says that new quotes and unpinned clinics move to it); that is a courtesy, and the server gate plus the constraint are the protection. The history list is bounded, so the page hands the editor the active config on its own, from `getActivePricing()`, never by looking for it in the list: the editor must open on the version the page says is active. A stored config that fails `validatePricingConfig()` (a hand edit in Neon) cannot be activated, and reading it as the active or a pinned version is a loud `PricingError`, never a quiet switch to other prices. A clinic's pin (`Clinic.pricingVersionId`) is set by billing, when a self-serve clinic's first payment is confirmed (from the accepted plan); nothing on `/pulse` sets one.

**The name and logo sync.** On every signed-in page request `upsertClinicForClerkOrg()` copies the organization's name from Clerk, and its logo when Clerk has one. A logo set by Pulse staff survives when the organization has no logo of its own. A name changed on `/pulse` is written to the Clerk organization as well (`lib/organization.ts`), so it does not change back.

### Clinic branding and dependable playback (Prompt 10)

Pulse staff use a clinic's **Branding** tab at /pulse/clinics/[id]; an office admin uses /admin/branding. The clinic id for the admin save comes from its server-checked session, never the form. Members and closed clinics cannot save branding. Both forms validate the whole submission; malformed or duplicate values are refused. A failed response retains the draft so it can be retried. A repeat of a saved value adds no duplicate log entry.

The approved additions are nullable Clinic.brandColor and Clinic.brandFont, in migration 20260918184417_add_clinic_branding. One hex brand colour produces readable staff and patient shades. Choices are Inter (default), Open Sans, Source Sans, Montserrat, Nunito Sans and Merriweather. Fonts are built into the deployment and served from our own origin with display: swap; optional fonts are not preloaded. Text and playback never wait for them. The patient page retains its light background, approximately 20px body copy and minimum 15px text. Its authored controls are at least 48px and browser zoom stays enabled. Native video control sizes remain the browser's responsibility.

The colour, font and phone follow **last save wins, all changes logged**, through updateClinicBranding() and changeClinicWithLog(). The latter locks the row before reading, describing and writing a change. No second logo store exists. A clinic admin uploads its logo through **People > the organization panel > General > Update profile**. Pulse staff may set an approved HTTPS image address in Branding. A Clerk-uploaded logo takes priority when the next signed-in request syncs it; when Clerk has no image, the sync leaves the existing Clinic.logoUrl untouched, including a concurrent Pulse save. Clearing a Clerk image does not restore an older Pulse image: there is only one stored URL. Clerk sync remains request-driven; failed sync is retried on a later request. Patient pages read the stored copy without calling Clerk. Colour, font and phone are owned by our database, not written back to Clerk.

ClinicLogo reserves a fixed box and starts with a name/text fallback. Slow, unsupported or broken pictures do not move the player. Images load directly in the browser at low priority with no referrer; there is no unrestricted server image proxy. Pulse approves the source when entering its HTTPS address. A changed address resets the image state. The clinic mark is placed in a reserved strip **outside the video frame**, because even a translucent watermark can hide an anatomy label. Full clinic identity is available outside the truncated decorative mark.

Both players play inline. The patient player uses the browser's own video controls, shown from the first play on (before it, the big Play button is the only thing on the picture). One measured limit of those controls in Chrome and Edge: while keyboard focus is inside them, the page never hears Escape, so Escape does not close the enlarged view from there; Close always works and Tab reaches it. The library player keeps its own controls (scrub bar, play and start over, sound, full screen, keyboard shortcuts), decided by Evan on 2026-09-18 after a version with the browser's controls was tried and turned down; because they are ordinary buttons, Escape closes it from anywhere. What has to stay on screen for as long as the picture does (the placeholder chip and the clinic mark) sits in a 40px strip above the picture in both players, never over it; the library's title and controls do sit over the picture, but only while they are showing. Media failures show a calm retry state, and retries retain the last playback position. The patient page records only the first actual playing event per load; retries do not count a second play start. Expired, withdrawn and failed-video states offer a tap-to-call number only when the stored phone is valid. The patient enlargement button requests container fullscreen when the browser reports support; denial or absence uses a modal overlay with a close control, Escape, focus restoration, background isolation, scroll restoration, safe-area padding and visual-viewport updates. The library already opens in such an expanded overlay. Browser-native video fullscreen and Picture-in-Picture may omit all HTML branding. These features are branding, never copy protection.

### Light and dark staff screens

A clinic chooses **Dark or Light** on its Branding form (the same form in both places, so also on the Branding tab of `/pulse/clinics/[id]`). It is stored in the nullable `Clinic.brandTheme` (migration `20260919212810_add_clinic_brand_theme`), a short text key like `brandFont`, never a database enum: `"light"`, or nothing for dark, so a clinic that never chose and a clinic that chose dark are the same row. `parseBrandTheme()` in `lib/branding.ts` checks it when it is saved and again when it is read; anything else reads as dark.

- **It is the clinic's setting.** Not each person's, not the computer's own dark-mode setting, and nothing is stored in the browser. A member sees their clinic's mode and cannot change it. Saving it follows every other branding rule (who may save, the clinic id from the session, the whole form refused on a bad value, the draft kept, "Branding changed: mode changed from Dark to Light." in the clinic log, nothing written when nothing changed).
- **It covers the staff screens only:** everything inside the app shell, meaning `/library` and `/admin` with their menus, the Send panel, the cancel popup and Clerk's own pieces. **Not affected, on purpose:** the patient page (always light), `/pulse` (always dark), sign-in, sign-up and onboarding, the printed pamphlet, and the inside of the library's video player, which is black in both modes.
- **How it works: named colour tokens, one attribute.** No page under `app/library`, `app/admin` or the shared staff pieces in `components/ui` holds a hex code or `white/10` for a surface, a border or text. They use the token classes (`bg-ground`, `bg-surface`, `bg-sunken`, `bg-overlay`, `bg-field`, `bg-well`, `border-line`, `border-line-strong`, `text-ink`, `text-ink-soft`, `text-ink-muted`, `hover:bg-wash`, `bg-wash-strong`, `bg-scrim`, `text-warn`, `text-problem`, `text-danger`, `shadow-panel`, `shadow-drawer`, `shadow-lift`), defined in `app/globals.css`. The dark values there are exactly the colours the screens had before tokens existed and apply by default, which is why `/pulse` and sign-in are untouched. `data-theme="light"` on the app shell's outermost element gives the same names their light values. **New staff UI uses the tokens; a literal colour there is a bug in light mode.** The exceptions are things that sit on a picture or a fill and stay as they are in both modes: the labels and chips over a library tile or a thumbnail, the white box behind a QR code, the red "Yes, cancel it" button, the amber placeholder badge, and the clinic mark's white chip.
- **The server writes the attribute** (`staffLook()` in `app/brand-look.ts`, through `ClinicShell` to `AppShell`), so the first paint is already right. Never set it from a script after load.
- **The accent is worked out per mode.** `staffTheme(color, mode)` lightens the clinic's colour until it stands out from near-black, or darkens it until it stands out from the darkest light surface (`STAFF_LIGHT_GROUND`, the icon rail). `text-brand-bright` is a pale shade on dark and a DARK shade on light. The shell also carries the dark-ground shades (`darkGroundVars()`), and anything marked `data-theme="dark"` inside a light clinic, which today is the video player overlay, goes back to the dark tokens and those shades; an element marked that way must also set `text-ink` itself, because an inherited text colour does not change with the attribute.
- **Clerk's pieces** get their colours from `StaffClerkProvider`: left exactly as they were in a dark clinic, given the light screens' white, ink and accent in a light one.
- **The logo sits on the banner with nothing behind it,** so a dark logo suits Light and a white or pale one suits Dark. The form says so in one sentence; no chip comes back behind the logo.
- **Readable by test, not by eye.** `lib/branding.test.ts` reads the light block of `app/globals.css` itself and checks every kind of text (4.5:1) and every button or text-box edge (3:1) on every light surface, plain and under a hover wash, plus the accent for all 216 grid colours in both modes. Change a light value and that test says whether something stopped being readable.

**Pilot acceptance is still required.** Neither styling nor mocked tests prove usable narration captions, real-device playback or the two-second first-frame target. See docs/branding-verification.md for actual checks and remaining sign-in, physical-device and caption acceptance. No claim of readiness is made until those checks are recorded.

**Neon needs both URLs.** `DATABASE_URL` is the pooled connection the app uses; `DIRECT_URL` is the unpooled one Prisma needs to run migrations. Leaving `directUrl` out causes migrations to fail in ways that are hard to read.

**Placeholder videos.** A video with `isPlaceholder` true carries a real procedure name but plays a sample animation, so the library can be tested before the finished animations exist. This is not the same as unpublished: placeholders are visible on purpose. The app marks them everywhere they appear: an amber "Placeholder" mark on the library card, in the player, across the top of the patient page, and in the admin lists. The Send panel carries the selected video's placeholder mark. The printed pamphlet still needs it (review checklist item A2); the first task that touches that page adds it. **If you show a video somewhere new, carry the mark with it.** Placeholders are added, edited and replaced on `/pulse/videos` like any other video; `prisma/seed-placeholders.ts` only fills a fresh database, and `prisma/seed-video.ts` (the first real animation) never touches them.

**What `viewCount` means.** It counts play starts on the patient page: one per page load, the first time the video actually starts playing (the browser's `playing` event, not the tap, not the page opening, not a text message previewing the link, not the poster or the first bytes being fetched, and not a pause or a resume), for a published, unexpired link. It is not unique patients, not completed watches, and not evidence that anyone understood anything (see Writing copy). Any number derived from it is labelled by what it actually measures, and a link with none is "Not played yet", never "Not opened".

**How a link expires.** The rule is `lib/expiry.ts`, pure, and every page and write asks it. A link made by `createShare()` is a **first-play link** (`Share.expiryPolicy` FIRST_PLAY): it stops after the platform's `unclaimedDays` (90 by default) if nobody plays it, and the first real play (`recordSharePlay()`, called by the patient player) moves `expiresAt` to that moment plus the days copied onto the link when it was made (`Share.daysAfterFirstPlay`: the clinic's `viewDaysOverride` when Pulse staff have set one, else the platform's `viewDays`, 7 by default). That move happens exactly once: the claim is one UPDATE whose WHERE says "still unclaimed, still before the deadline, video still published", so two first plays at once move the deadline once, and later plays only add to the count. A play at the deadline itself or after it, on a cancelled link, or on an unpublished video writes nothing, whenever the page was opened: the server's clock decides. Every link made before this rule, and any link written without the column, is a **legacy link** (FIXED, the database default): its date was set when it was made and playing it changes nothing but the count. No backfill touched them, and none ever should. A settings edit changes links made from then on only; the numbers a link carries are the ones it was promised with, and a save that lands while a link is being made waits for it (the settings lock, above). **Both numbers have limits: a whole number of days from 1 to 365** (`MIN_LINK_DAYS` and `MAX_LINK_DAYS` in `lib/expiry.ts`, the limit the clinic override always had). The settings form and the override form refuse anything outside them, and `resolveShareTerms()` refuses again right before the numbers become dates, with a `ShareTermsError` whose message is a plain sentence and nothing written; `/admin/links` then says links cannot be made and asks for Pulse 3D instead of failing. A stored days-after-first-play outside the limits (nothing in the app writes one) never becomes a deadline either: `canClaimFirstPlay()` treats it as a fixed link. The admin pages say all of this in words beside each link (`shareExpiryState()`), and `/admin/links` and the library's Send panel read the same resolved numbers (`getShareTerms()`) that `createShare()` copies onto a new link, so the words and the link cannot disagree. Nothing on the patient page mentions a deadline; a play that could not be recorded is simply not counted, and a first-play link then keeps its longer unclaimed deadline, so the patient is never worse off for it. There is no renewal and no "get a new link" button: an expired link is expired, and the calm page tells the patient to ask the practice for a fresh one.

---

## Folder map

```
app/watch/[code]     The patient viewer. Phone-first, no login, no navigation.
app/library          The surgeon's exam-room browser. Tablet-first. Browse, play, send. Shows only what the clinic's plan allows; ComingSoon.tsx and CategoryStates.tsx draw the tiles and pages for a category it cannot open (coming soon, locked, nothing yet).
app/admin            The clinic admin area. /admin is the office manager's overview (page.tsx); AdminFrame.tsx is the frame every admin page draws itself in.
app/admin/links/     Shared links, the complete workspace: ShareLists.tsx (the two lists and their filters), CreateShareForm.tsx, CancelShareButton.tsx, and actions.ts (the create and cancel Server Actions).
app/admin/print/     The printable pamphlet for one share link.
app/admin/qr/        The QR code image for one share link.
app/admin/people/    The People section: the clinic's seats in use, everyone in the clinic with Member / Member with admin, their seat, Give a seat and Remove; Invite someone and the open invitations with Revoke; the owner's handoff; and Clerk's panel for the clinic's name and logo. PeopleControls.tsx holds the buttons and forms, ConfirmButton.tsx the "Are you sure?" popup. actions.ts holds the Server Actions, each of which goes through lib/seat-changes.ts. Admins only, and nothing to manage until the clinic is open.
app/admin/billing/   Billing: the plan and its estimate, the plan picker, and the subscription once there is one. billing.ts works out the plan on file and its estimate; checkout-view.ts works out what is offered (picker, contact Pulse, managed, subscribed, not open); page.tsx turns both into words. Open to an admin of a closed clinic. actions.ts holds startCheckoutAction (PlanPicker.tsx) and checkPaymentAction; there is no practice question here, since only Pulse staff mark a hospital. return/ is where Stripe sends the admin back to: page.tsx reads the billing record and grants nothing; Confirming.tsx looks again a bounded number of times and offers Check again.
app/api/webhooks/stripe/   Where Stripe sends its notifications. Public; the signature is the check. See "Billing state".
app/admin/branding/  The clinic branding form and its admin-only Server Action.
app/admin/reports/   A placeholder until clinic reporting is built.
app/onboarding       Set up your clinic (Clerk's CreateOrganization), after which its creator is the account owner and goes to /admin/billing; someone who joined by invitation goes to /library. kind/ only redirects: the surgeon question is retired.
app/pulse            The Pulse 3D master dashboard. Pulse staff only. The clinics table at /pulse; actions.ts holds every Server Action; ui.tsx the shared pieces.
app/pulse/clinics/   One clinic behind a row of pills (ClinicTabs.tsx): overview, plan, details, branding, people, links, notes. forms.tsx holds the client forms.
app/pulse/settings/  The AppSettings form.
app/pulse/videos     The catalogue: every video in a table with filters, plus the Categories panel (CategoryConfigForm.tsx). new/ adds a video, [id]/ edits one; both use VideoForm.tsx.
app/pulse/pricing    Pricing: the editor, the live calculator and the version history, all in PricingEditor.tsx. Saving and Make active go through actions.ts.
app/pulse/billing    Billing diagnostics: what became of each notification from Stripe, and Try again (RetryButton.tsx). Never a key, a secret, an error message or a notification's contents.
app/pulse/reports    Placeholder page until Reports is built.
app/pulse/FormBits.tsx   Outcome and SaveButton, the two pieces every dashboard form ends with.
app/sign-in          The staff sign-in page, Clerk's prebuilt <SignIn /> component.
app/sign-up          The staff sign-up page, Clerk's prebuilt <SignUp /> component. A new account is sent on to /onboarding.
proxy.ts             Clerk's middleware. Sends signed-out visitors of /admin, /library, /pulse and /onboarding to /sign-in.
lib/db/              EVERY database query. Nothing else touches Prisma. clinics.ts holds the organization-to-clinic lookup, the first-use upsert, getClinicPlan() for /admin/billing, the Pulse-side reads and writes, and updateClinicBranding() (both branding pages save through it). clinic-lock.ts holds readClinicLocked(), the row-locking read changeClinicWithLog() starts with. access.ts holds getClinicAccess() and canUseVideo(), the reads behind the access rule, and the two locking reads (lockClinicAccess, lockVideoFacts) createShare() uses inside its transaction. shares.ts holds every share-link query, including createShare() (the one guarded write, see Category entitlements) and the overview's summarizeSharesForClinic() and listRecentSharesForClinic(). settings.ts holds getSettings(), lockSettings() (the read a link being made uses, inside its transaction, with the settings lock held shared) and saveSettings() (which takes that lock exclusively). notes.ts holds the clinic log. videos.ts holds the clinic-side lists (listUsableVideos and listUsableVideosInCategory, filtered by the clinic's access in the query; countPublishedVideosByKind for the library states) and the Pulse-side catalogue (listVideosForPulse, createVideo, updateVideo). category-config.ts holds the per-category rows, comingSoonSentence(), getCategoryAvailability() and listSellableCategories(). pricing.ts holds the version store: listPricingVersions, createPricingVersion, activatePricingVersion, getActivePricing, getPricingForClinic. billing.ts holds every billing query: setStripeCustomer(), recordAcceptedPlan(), acceptPlanForCheckout() (the purchase attempt, written or found again under the clinic's row lock) and getCheckoutFacts(), receiveBillingEvent() and the other notification rows, and reconcileSubscription(), the one transaction that brings a clinic into line with Stripe. clinics.ts also holds setClinicStatusByStaff(), setClinicManagedByPulse() and setClinicPracticeType(), which work the status out again as they write, and setClinicPlan(), which refuses to lower the seats below the number in use without the explicit override. seats.ts holds every query on who holds a seat, a person's or an invitation's: reserveSeat(), releaseSeat(), holdSeatForInvitation(), linkSeatHold(), releaseSeatHold(), applySeatCheck(), getSeatSummary(), and countSeatsInUseIn() (people and invitations together) for the plan and billing writers. seat-lock.ts holds readSeatsLocked(), the lock-then-count every seat that is taken starts with. clinics.ts also holds setClinicOwner(), the owner write for a handoff and for Pulse staff.
lib/access.ts        The access rule, pure: decideVideoAccess() (may this clinic use this video, and why not), categoryState() (coming soon, locked, nothing yet, available), accessRefusalMessage(). No database; lib/db/access.ts feeds it.
lib/admin-nav.ts     The sections of the clinic admin area and activeAdminSection(), the rule for which one an address belongs to. Pure; AdminNav and the admin pull-out menu in AppShell both render from it.
lib/pricing.ts       The pricing engine: the config type and its validator, quote(), the built-in defaults, and the dollar and percent reading and writing. Pure, no database, safe for the browser. Never a price literal anywhere else.
lib/billing-state.ts The billing rules, pure and safe for the browser: effectiveAccess() (the state table), decideBilling() (what one look at Stripe means for a clinic's record), graceDeadline(), selfServeEligibility(), and the words for each status. No database, no Stripe.
lib/billing-events.ts What happens to a verified notification: handleStripeEvent() and retryBillingEvent(). Server only.
lib/stripe.ts        The only file that talks to Stripe. Server only. Test keys only. verifyWebhook(), eventRefs() (the two ids taken from a notification), fetchSubscriptionSnapshot(). For checkout: checkoutIsOpen() (never on the production deployment), checkoutSessionParams() (exactly what Stripe is asked to charge, pure), and stripeGateway, the CheckoutGateway the flow is handed (customer, payment pages, subscriptions; the two creating calls carry idempotency keys).
lib/checkout.ts      Self-serve checkout, server only: startCheckout() (eligibility, the server's price, the customer, the attempt, the payment page, closing every other page) and checkPayment() (Check again: the same reconcile the webhook runs). Opens nothing by itself.
lib/checkout-rules.ts The checkout rules that need no database, safe for the browser: readPlanSelection() (what the form may say), samePlanShape(), attemptIsReusable(), sessionExpiresAt(), SESSION_MINUTES.
lib/trusted-origin.ts pickTrustedOrigin(): which address Stripe may send a person back to. The Host header only picks among addresses the deployment knows are its own. Pure.
lib/pulse.ts         isPulseStaff() and requirePulseStaff(). The one gate for /pulse.
lib/phone.ts         US phone numbers: normalizeUsPhone() to ten digits for storing, formatUsPhone() for showing, telHref() for a tap-to-call link.
lib/branding.ts      The branding rules, pure and safe for the browser: the font list, the two modes (parseBrandTheme(), dark by default), parseBrandColor(), parseBrandFont(), parseLogoUrl() (https only), and staffTheme(color, mode) / patientTheme(), which turn one brand colour into shades that stay readable on a dark or a light ground. darkGroundVars() for the video player, which stays black. The Pulse look when nothing is set.
lib/branding-form.ts readBrandingForm() and readLogoField(): the one set of checks both branding save actions use. Pure.
lib/playback.ts      Small playback rules both players share: which refused play is a real failure, how long before "still loading" is said, where Try again picks up.
app/brand-fonts.ts   The five optional fonts, declared for Next.js's font loader (served from our own address, never preloaded). brandFontClass() and brandFontFamily().
app/brand-look.ts    patientLook() and staffLook(): a clinic's stored branding turned into the CSS variables, font class, light-or-dark mode, checked logo address and call link a page draws with.
app/globals.css      The colour tokens: the brand accent's four values, and the staff screens' surfaces, borders and text as named values with a dark set (the default) and a light set (data-theme="light"). See "Light and dark staff screens".
lib/organization.ts  renameClerkOrganization(). Writes a clinic's new name back to its Clerk organization.
lib/video.ts         getPlaybackUrl(). The only place a video URL is built. describeVideoSource(), the "CDN" (later "Mux") word on /pulse/videos.
lib/clinic.ts        getCurrentClinic() (creates the clinic on first use, syncs name and logo), getCurrentClinicId() for actions, getBillingClinicId() for the billing actions only (admin, open or not), requireClinicPage() for pages. The one place the signed-in user meets the database.
lib/clinic-status.ts clinicIsOpen(clinic): ACTIVE, or PAST_DUE before its grace deadline. The one place that decides whether a clinic may use the app.
lib/roles.ts         isClinicAdmin(), server only. See Roles.
lib/role-names.ts    The two Clerk roles, their keys and their words ("Member", "Member with admin"). Pure, safe for the browser.
lib/people.ts        The people and invitations in a clinic, from Clerk: listPeople(), getMember() (is this user id really in this clinic), listOpenInvitations(), invitationIsOpen(), getSignedInName(). The writes (sendInvitationFromClerk, revokeInvitationInClerk, setRoleInClerk, removeFromClerk) may only be called from lib/seat-changes.ts. Never touches lib/db.
lib/seats.ts         The seat rules, pure and safe for the browser: seatSummary() (people and invitations) and hasFreeSeat(), checkSeatReduction(), planSeatCheck() (what to change to bring the seats and holds into line with the clinic's people and invitations), seatStateOf() (held, waiting, or none for the owner) and the sentences an admin is shown. Read its top comment first. No database, no Clerk.
lib/seat-changes.ts  The only way anyone's seat, role, invitation or ownership changes, server only: inviteSomeone(), revokeInvitation(), setAdmin(), removePerson(), giveSeat(), releaseOwnSeat(), handOffOwner(), setOwnerByStaff(), and checkSeats() (bring a clinic's seats into line with Clerk, and return everyone with where they stand). Each one's order of steps, and what happens when one fails, is in its comments.
lib/testing/         fake-clerk.ts, an in-memory stand-in for Clerk (organizations, members, roles, invitations, Pulse staff) that the tests swap in. Nothing in the app imports it.
lib/share-link.ts    watchLink() and qrFileName(). The only place a patient link is built.
lib/base-url.ts      getBaseUrl(). The site's own address, read from the request, so links work on any deployment.
lib/qr.ts            QR codes for share links, as PNG (download) or SVG (print).
lib/brand.ts         The logo address, and where a clinic is sent to talk to Pulse 3D (the schedule-a-call page).
lib/format.ts        formatDuration(), seconds as "4:12" for the staff screens. describeDuration(), "About 2 minutes" for the patient page. parseDuration(), "4:12" typed on /pulse/videos back into seconds.
lib/expiry.ts        The expiry rule, pure: MIN_LINK_DAYS and MAX_LINK_DAYS (1 to 365) with isValidLinkDays(), resolveShareTerms() (the settings and a clinic's override become the numbers a new link carries, refused with a ShareTermsError outside the limits), isExpired(), canClaimFirstPlay(), expiryAfterFirstPlay(), shareExpiryState() (expired, awaiting, played, fixed) and daysLeftText(). No database; lib/db/shares.ts, the Pulse forms and the admin pages ask it.
prisma/              Schema, migrations, and the scripts: seed, seed-video, seed-placeholders (both for a fresh database only; the catalogue is edited at /pulse/videos), link-clinic, set-status, set-plan.
components/ui/       Shared buttons, cards, layout. AppShell is the frame around the library and admin: a banner across the top with the clinic's logo (or its name), an icon rail with the library icon, the admin icon (admins only) and Clerk's user button, and the two pull-out menus the icons open (categories, and the admin sections from lib/admin-nav.ts). AdminNav is the row of section links on every admin page. PulseShell is the same for /pulse. StaffClerkProvider, ClinicClosed (clinic not open; a member is told to ask an office admin) and AdminsOnly (a member on an admin page, with its own words on the Billing pages) are the auth pieces. styles.ts holds the shared button and form-field looks. The branding pieces: ClinicShell (AppShell dressed in one clinic's look), BrandingForm (the one form both branding pages use), ClinicLogo (a logo in a box of fixed size, with the name standing in), ClinicMark (the small clinic chip in the strip above a video), VideoPlayer (the library's player) and useModalFocus (what every full-screen overlay uses to hold focus, keep the page behind it still and fit the visible screen).
docs/                branding-verification.md: what was actually checked for the branding work, on what, and the device and caption checks still owed.
vitest.setup.ts      Points the tests at the testing database and refuses to run against production. The decision itself is vitest.guard.ts, a pure function with its own tests.
vitest.fonts.ts      A stand-in for Next.js's font loader, which only exists inside a Next.js build. It needs one line for each font named in app/brand-fonts.ts.
.claude/skills/      Two process skills Claude loads here automatically: verification-before-completion, systematic-debugging. See its README. Never put .ts files under .claude/.
```

---

## Tests

`npm test` runs Vitest. Tests live next to the code they cover (`lib/db/clinics.test.ts` covers `lib/db/clinics.ts`; `lib/db/videos.test.ts` covers the catalogue; `app/pulse/actions.test.ts` covers the dashboard's actions; pure rules such as `lib/clinic-status.ts` and `lib/format.ts` get a plain test with no database) and hit a real database: the Neon branch called `testing`, whose pooled connection string is `TEST_DATABASE_URL` in `.env.test` (gitignored, like `.env`). `vitest.setup.ts` points Prisma at it, and **refuses to run unless it can show that is not production**: the decision is in `vitest.guard.ts` (which has its own tests) and it fails closed. The test string and every production string that is set must be readable, at least one production string must be set so there is something to compare against, and the test string may not name the same Neon endpoint as `DATABASE_URL` or `DIRECT_URL`, pooled or direct (Neon's `-pooler` address and the direct address of one endpoint count as the same database). That refusal is never bypassed, disabled or loosened to make a test run.

- Tests must pass before any pull request that touches `lib/db`.
- **Tests create their own rows and delete them by id afterwards. They never touch, reset or overwrite rows they did not make.** A table with one shared row (AppSettings) is tested against an in-memory stand-in for the Prisma client instead (`lib/db/settings.test.ts`), because there is no row a test could call its own; a test that wants to see "the defaults" never deletes the real row to get them.
- `vitest.guard.test.ts` exercises the guard with **made-up connection strings only**. No test, log line or error message ever prints a real connection string, not even the rejected one; a refusal names the variable, never the value.
- `lib/pricing.test.ts` is the price fixtures, pure, and carries the record of the pricing decision. `lib/db/pricing.test.ts` hits the real testing database, and because only one version can be active in the whole table, it remembers which one was active when it started and makes it active again at the end. `lib/db/pricing.defaults.test.ts` uses an in-memory stand-in for the empty-installation and damaged-active-version cases, for the same reason the settings test does.
- Tests in `lib/db` never need Clerk. A gate or an action that reads the signed-in user (`lib/pulse.test.ts`, `app/pulse/actions.test.ts`, `app/admin/links/actions.test.ts`, `app/library/[category]/actions.test.ts`) replaces Clerk with `vi.mock("@clerk/nextjs/server")` and plays a staff member, an admin, a member or an ordinary user. A whole route can be rendered the same way (`app/admin/pages.test.tsx` renders the overview, Shared links and Billing, and `app/library/pages.test.tsx` the library home and a category page, with `renderToStaticMarkup`, Clerk's client pieces and `next/navigation` replaced), which proves what each kind of person is shown; clicking is still checked on the preview.
- The access rule is tested four ways: `lib/access.test.ts` with plain values (every reason, the order of the checks, the four category states), `lib/db/access.test.ts` and `lib/db/shares.test.ts` against the database (two clinics with different plans asked about the same video, paused and pending clinics, unpublished and missing videos, placeholders hidden, and a link already issued outliving the plan change that refuses a new one), the action tests with a forged clinic id in the form and a form replayed after the plan changed, and `lib/db/shares.race.test.ts` for the forced overlap: it wraps the locking video read for one call so a plan removal, a pause, a placeholder-setting change or an unpublish is started after both rows are locked and before the insert, and checks that the change waited for the link to commit. Its control does the same with a plain read and shows the change getting through, which is what the locks prevent and proves the test would catch their removal. The shared test database holds published videos in most categories, so a test that needs "a category with nothing in it" works the expected state out from the real counts with the same rule the page uses rather than assuming.
- Seats and the account owner are tested four ways. `lib/seats.test.ts` is the rules with plain values, invitations and the owner included. `lib/db/seats.test.ts` is the tables against the database: seats and holds given until the plan is full (an invitation's hold counting like a seat), a repeat not counted twice, five people or five invitations at once for the last seat, one clinic's seats and holds nothing to do with another's, an accepted invitation turning into a seat in one step, and every guard in `applySeatCheck()`. `lib/db/seats.race.test.ts` is the forced overlap: it wraps `readSeatsLocked()` for one call so a second request is started after the first has counted and before it writes, and checks that the second waited and was refused, for two people, two invitations, and an invitation against a person; its controls do the same with a plain count and show BOTH taking the one seat, which is what the lock prevents and proves the test would catch its removal; another test lowers the plan in that gap. (The wait is two seconds, several times what an unblocked request takes against the remote database, so a control cannot fail for slowness.) `lib/seat-changes.test.ts` runs every change in `lib/seat-changes.ts` against the database with the in-memory stand-in for Clerk (`lib/testing/fake-clerk.ts`), which can be made to fail a write or have things done behind the app's back: the owner made on sign-up with no seat, inviting until full, two invitations at once for the last seat, a failed Clerk invitation giving the seat back, an unrecorded invitation id found later, an accepted invitation becoming its person's seat, revoking here and in Clerk's panel, an invitation made outside the page, admin on and off, the owner protected from removal and from losing admin, the last admin kept, removal, giving a seat, the owner taking and giving up a seat, handoffs (including two at once), Pulse staff setting an owner, the owner leaving, people once marked staff shown waiting, and a person or invitation of another clinic out of reach. It also reads the source tree and fails if anything but `lib/seat-changes.ts` calls the Clerk writes. `app/admin/people/actions.test.ts` covers signed out, a member (who cannot switch admin), an admin, an admin of another clinic, a clinic that has not paid, and a failure answered in plain words; `app/pulse/owner-action.test.ts` covers "Make account owner" for staff and non-staff. **A stand-in is not Clerk:** the walkthrough with a real Clerk test organization is a separate check.
- Billing is tested without Stripe and without a real id, key or notification. `lib/billing-state.test.ts` is the state table row by row, plus every transition of `decideBilling()` (first payment, a failed first payment, a failed renewal, repeated failures, recovery only on a paid invoice, scheduled and final cancellation, an unrelated or old subscription, a second live one, a trial) and the grace boundaries. `lib/db/billing.test.ts` runs the whole processor against the database with an in-memory stand-in for "where does this subscription stand now": repeats, reversed delivery, several notifications at once, the same one three times at once, Stripe unreachable and then retried, a failure partway through rolling back what was already written, another customer's subscription, the old subscription's late cancellation, grace inside and past its deadline with `createShare()` allowed and refused, a staff pause surviving payments, a managed clinic untouched, and one clinic's news never touching another. `lib/stripe.test.ts` and `app/api/webhooks/stripe/route.test.ts` use Stripe's own signing arithmetic with a made-up secret: a valid signature, a wrong secret, a changed body, the same JSON re-spaced, a replay older than the tolerance, and that nothing is handed on before the check passes. The action tests cover the staff gate, the forged clinic id, the practice type set by staff and the "still being charged" words. A local run against real Stripe test mode with the Stripe CLI is a separate check that needs a test key.
- Checkout is tested the same way, with an in-memory stand-in for Stripe that behaves as the real one is documented to where these rules depend on it (one customer per clinic, one page per plan id and the FIRST answer again for a repeated key, closed pages stay closed, a paid page becomes a subscription carrying the plan id). `lib/checkout.test.ts` runs the flow against the database: the exact monthly and yearly amounts and the full library, a clinic Pulse staff never marked (UNKNOWN) checking out like a clinic and staying UNKNOWN, every refusal with nothing made (a hospital, more seats than the Clinic maximum, a managed clinic, a clinic paused by hand, a category not for sale, an estimate, a deployment where checkout is shut), a forged total and a forged version, prices changed while the page was open and an attempt honoured after they changed, three identical requests at once ending with one customer, one attempt and one page, different picks in a second tab, a paid page pressed again, a page closed from under its attempt, a second subscription refused, one clinic never touching another, and that starting a checkout opens nothing while the webhook, and Check again, do. It hands in which version is active and which categories are for sale, and saves its own pricing versions without ever making one active. `lib/db/billing.checkout.test.ts` calls the attempt writer directly, because its checks under the row lock are the ones that count. `lib/checkout-rules.test.ts`, `lib/trusted-origin.test.ts` and the additions to `lib/stripe.test.ts` and `lib/billing-state.test.ts` are pure. `app/admin/billing/checkout-actions.test.ts` covers signed out, a member, a forged clinic id, fields that are never read (a practice type among them), a forged Host header and a failure answered in plain words; `checkout-pages.test.tsx` renders Billing and the return page for every kind of clinic and person. None of it proves Stripe's hosted page or a real delivery: that is a browser check with a test card.
- The expiry rule is tested twice: `lib/expiry.test.ts` with plain values, and `lib/db/shares.expiry.test.ts` against the database, with a clock handed in for every call (legacy links written without the new columns stay as issued; first, second and three simultaneous plays; a play just before the unclaimed deadline, at it, and after it; a clinic's number changed after a link was made; unpublished, cancelled and missing links). `app/watch/[code]/actions.test.ts` covers the patient action, including a server failure answered with `recorded: false`. The testing branch's settings row may hold any numbers, so those tests read `getSettings()` and check the link against whatever it holds rather than assuming 90 and 7. The limits are tested at every layer: the pure rule at 0, 1, 365 and 366 (and non-numbers), `createShare()` with a clinic number of exactly a year and one past it (refused, nothing written), the settings and override actions at the same edges (with `saveSettings` a stand-in, since the row is shared), and the links page drawing its "cannot be made" words instead of failing. The settings lock has its own forced overlap in `lib/db/shares.race.test.ts`: a save started after the settings were read and before the insert has to wait for the link, and its control with a plain read shows the save getting through and the link written with numbers already replaced; those tests put the shared settings row back exactly as they found it (saved again, or removed if they created it).
- **What a test suite for a change covers:** the permission boundary (signed out, member, admin, another clinic, Pulse staff, whichever apply), tenant isolation (one clinic cannot read or change another's rows), invalid input, the failure path, a forced overlap where two writes can race, and the behavior that existed before the change.
- After any schema migration, apply it to the `testing` branch with `migrate deploy` (step 2 of "How a schema change ships", under rule 3) before running the tests. Never reset the testing branch to catch it up: a reset copies production's rows into it and throws away whatever the tests had there. If Evan wants a reset, he does it himself.
- Tests are not part of the Vercel build and not a required GitHub check yet.

## Design

Match the live Pulse 3D site. Do not invent a new palette.

- Font: **Inter** by default. A clinic may choose one of the approved fonts (listed under "Clinic branding and dependable playback") for its own surfaces; Pulse's own screens keep Inter
- Accent: `#2a829b` · Accent deep: `#1e5668` · Accent bright (on dark): `#5fb8d4`
- Light band: `#e4ebf3` · Black: `#000000`
- **Dark staff screens (the default, and all of `/pulse`):** page `#000000` · cards `#0d1113` · rail and text boxes `#07090b` · menus `#0a0d0f` · headings `#ffffff` · body text `#bfbfbf` · muted `#667085` · hairlines white at 10%, button and text-box edges white at 15% · amber `#f3b94d`
- **Light staff screens (a clinic's choice), the patient page's family:** page `#fbfaf7` · cards, menus and text boxes `#ffffff` · rail `#f4f1ea` · headings `#12202a` · body text `#3a4c56` · muted `#52616a` · hairlines `#e2ddd2`, button and text-box edges `#7f796c` · amber text `#684400` · Pulse accent `#1e5668`, which is also the link shade
- In code these are never written as hex: use the token classes (see "Light and dark staff screens"). The values live in `app/globals.css`.

**No monospace fonts anywhere in the interface.**

---

## The speed rule

`app/watch` and `app/library` are both governed by one sentence from a surgeon:

> "The second I have a delay, I will just turn it off and I will just bring up my own stuff."

**This is a performance specification, not a preference.** It applies to both in-room surfaces and outranks any feature that would slow them down. If a change would delay the first frame or add a step, flag it before building.

### `app/watch`, the patient viewer

- **Zero friction.** No account, no login, no password, no app to install, no cookie banner, no email capture, no confirmation step before the video. Scan, watch, done.
- **The video starts in under two seconds.**
- **Phone-first.** Assume a 65-year-old on cellular data in a waiting room, holding their own phone, possibly anxious. Large tap targets, high contrast, no small text.
- **Nothing to click except play.** No navigation, no menu, no related videos, no footer links, no sales.
- **The expired state is a real design job, not an error page.** Calm, plain language, tells them to ask their doctor for a new link. Never technical, never red, never the words "error", "invalid" or "403". The same goes for a video that will not load: a plain sentence and a way to try again, never the exception.

### `app/library`, the surgeon in the room

- **Two taps from opening it to a playing video.** That is the design budget.
- **Tablet-first.** Big thumbnails, procedure names large enough to read at arm's length, no dense tables and no tiny controls.
- **Browse by category**, because a surgeon knows the body part before they know the procedure name.
- **Playing and sending are separate actions, both one tap.** Sometimes they show it in the room, sometimes they send it home, often both.
- Assume it is being used standing up, one-handed, with a patient watching. Nothing that needs careful aim.

---

## Writing copy

Van's voice: plain-spoken, direct, no wind-up. Peer to peer. Simplest honest version first, then a concrete example.

- **No em dashes.** Use commas, colons or parentheses.
- No marketing language in the product interface.
- Never claim the product guarantees a patient understands anything, and never say it replaces or satisfies informed consent. It **supports** the consent conversation. This wording matters legally and is not flexible.
- **A number is labelled by what it measures.** A play start is a play start. A link that was issued is a link that was issued. Neither is a unique patient, a completed watch, proof that someone understood, or evidence of consent, and no screen, report, PR or sales page describes it as any of those. When a QR code later mints child links, an issued child link is not a proven unique scan or person either.
- **Technical failures never reach a patient.** Exception text, status codes and stack traces go to the server log; the patient sees a calm sentence and a way to try again.
- **Security limits are stated honestly.** An expiring link, a signed address and a cancelled link limit who can start a new play. They do not stop screenshots, do not stop all copying, and do not take back what a phone has already loaded. Never promise more than that to a clinic.

---

## Commits and pull requests

**Commits:** plain English, present tense, one line. "Add expiry check to watch page." Not "feat(watch): implement TTL validation middleware."

**One prompt, one pull request** (rule 5), and its description is written for Evan, who cannot read the code. It says:

- the problem, and the behavior once the change is in;
- every migration and every script that changes rows, with the production order, why the old code keeps working during the minutes in between, and how it would be recovered (rule 3);
- exactly which checks ran and what they showed: lint, `tsc`, the test count and files, the build, the browser check, and any real-device check with the device named;
- a numbered preview walkthrough for the things only a signed-in person can try;
- the risks, and everything that remains unverified or unfinished, in as many words.

**A green summary is evidence, not a review.** Claude never merges, never migrates production, never runs a production data script, never changes a live vendor setting and never deletes an external asset. Those wait for Evan's explicit instruction after he has read the PR; reading it is not the instruction.

**When behavior changes, this file changes with it**, and the desktop copy (`3 - Repo rules file.md`) is updated to match in the same PR. An old sentence that no longer holds is removed, not left beside the new one.
