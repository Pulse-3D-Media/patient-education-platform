# CLAUDE.md

The rules file for the `patient-education-platform` repository, where it lives as `CLAUDE.md` in the root.
Claude reads it automatically at the start of every session, so this is the one place project rules belong.

A copy is kept on the desktop as `3 - Repo rules file.md`. If you edit one, copy it to the other.

---

## What this is

The Pulse 3D Patient Education Platform. Surgical patient education animations, delivered to patients on their own phones.

A clinic creates a share link. The patient scans a QR code or opens the link, watches an animation explaining their upcoming procedure, and the link expires after a set number of days.

**Phase 1 is done:** create a link, watch a video, link expires.
**We are in Phase 2, the clinic dashboard:** logins (done, see Auth), clinics and people (done, see Roles), the Pulse 3D master dashboard (done, see the four surfaces), the clinic admin area's sections (done: overview, shared links, people, billing), then billing itself, branding, real video hosting.
**Phase 3 is billing.**

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

The only functions that take no `clinicId` are the ones behind the patient's link, where the share code in the URL is the key: `getShareByCode()` and `recordShareView()`. That is the whole list. If a task seems to need another public-by-code function, say so first.

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
- **Read, decide and write in one transaction when the decision depends on the read.** Two staff members saving at once must not each describe a stale "before". When a change has a log entry, the entry and the change commit together and describe the same transition (`changeClinicWithLog()` in `lib/db/clinics.ts` is the pattern; its read still happens before the transaction opens, which is on the review checklist to fix, so move it inside rather than copying it). For any write that matters, test a forced overlap, not just the happy path.
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

**`app/watch` is the patient's page, and it stays about one thing.** No account, no email, no app to install, no consent screen, no second confirmation, no cookie banner before the video plays. One procedure, the clinic's name (and logo, when branding ships), calm plain language, large controls, and nothing else: no navigation, no related videos, no sales, no link to anywhere but play. See the speed rule below.

**`app/library` is the exam-room surface.** A surgeon opens it mid-consult, finds the procedure, and either plays it right there on their own device or sends the patient a link. It is used standing up, in front of a patient, under time pressure. **It obeys the same speed rule as the patient viewer**: tablet-first, big touch targets, **browse to playing in two taps**, Play and Send as **separate one-tap actions**, no dense tables.

**`app/admin` is the back-office surface**, and its pages have fixed jobs. Keep this map stable; do not move a job to another page or merge two of them:

| Page | Job |
|---|---|
| `/admin` | The office manager's **overview**: the notice from Pulse, what needs a look (links that stopped working, links about to expire), a few counts, the newest five links, and a card into each section. Not the full list of anything: it reads five counts and five rows (`summarizeSharesForClinic()` and `listRecentSharesForClinic()` in `lib/db/shares.ts`), never the whole history. |
| `/admin/links` | **Every share link and QR code**: create, search, filter, copy, download the QR picture, print the pamphlet, cancel. The complete workspace. The pamphlet (`/admin/print/<code>`) and the QR picture (`/admin/qr/<code>`) belong to it. |
| `/admin/people` | People and roles. |
| `/admin/billing` | Plan, categories, seats, and an estimate labelled as one; later the subscription, payment method and invoices. **The only place plan or price information appears on the clinic side.** Its data comes from `getBillingView()` in `app/admin/billing/billing.ts`, which reads the plan through `getClinicPlan()` and quotes it with the engine in `lib/pricing.ts`; no page repeats that arithmetic. |
| `/admin/reports` | Clinic reporting, when built. A placeholder page today, marked Coming in the navigation, so the link never leads nowhere. |

**Never turn the overview back into the links list, and never put plan or billing detail on the overview or on the links page.** Every admin page draws itself inside `AdminFrame` (`app/admin/AdminFrame.tsx`): the app shell, the clinic's name, the row of section links (`AdminNav`, driven by the list and the current-page rule in `lib/admin-nav.ts`), then the page's own title. The frame is drawn only after the page has checked that the person is an admin; a member gets `<AdminsOnly />` and no navigation at all. An admin of a closed clinic does get the frame on every page, with the closed-clinic message in place of the content, so Billing is always one tap away.

**Billing stays reachable when the clinic is not open.** A clinic that is PENDING, PAST_DUE, PAUSED or CANCELED cannot use the library or make new links (`clinicIsOpen()` says so), but its admin must still be able to open `/admin/billing` to see why and fix it: choose a plan, update a card, restart. So **permission to view and repair billing is separate from permission to use the app**, and `/admin/billing` is never behind the `ClinicClosed` page: it checks `isAdmin` and deliberately not `clinicIsOpen()`, and shows the status with what it means instead. A clinic that is managed by Pulse (`managedByPulse`) sees its plan as read-only, with no self-serve billing controls and a line saying Pulse manages it. Until card payment exists the page has no controls for anyone: the plan, the seats, an estimate marked as an estimate, and the words that nothing has been charged.

**`app/pulse` is the Pulse 3D master dashboard.** Used only by Pulse staff, Evan and Van. It shows every clinic, every video, and every price and rule. **Nothing on it is visible to clinics.** It is not a bigger `app/admin`: admin shows one clinic its own data, pulse sees across all of them, so the two never share a page.

**Who may open it is decided in one function, `isPulseStaff()` in `lib/pulse.ts`.** A person is Pulse staff when their Clerk user has `pulseStaff: true` in its public metadata, set by hand in the Clerk dashboard (Users, the user, Metadata, Public) and nowhere else. It is read on the server from Clerk's backend API on every request. **Every page and every Server Action under `app/pulse` calls `requirePulseStaff()` first**, which ends the request with not-found for anyone else: not a redirect, not a message, so the dashboard's existence is not confirmed to people who cannot use it. The `/pulse` layout checks too, so the not-found page has no dashboard rail around it. Never check this in the browser only.

Built so far: the clinics table (`/pulse`), one clinic's page (`/pulse/clinics/[id]`, six sections behind a row of pills: Overview with status by hand and managed-by-Pulse, Plan, Details, People, Links, and Notes, an append-only log to which every change saved on the page adds an entry of its own), the catalogue (`/pulse/videos`: every video, the add and edit form, and the Categories panel), the platform settings (`/pulse/settings`) and pricing (`/pulse/pricing`: the numbers behind every quote, a live calculator, and the saved versions with Make active on each). Reports is a placeholder page.

## Phase 1 scope

**In scope:** the three original models (Video, Clinic, Share) · `app/library` to browse and play · `app/admin` to create and manage share links · `app/watch/[code]` for patients · QR code generation · link expiry.

**Still not built unless a task asks for it:** per-clinic category entitlements, subscriptions, payments, Stripe, analytics dashboards, email sending, video uploading, file storage.

**Do not invent a login system.** Sign-in is **Clerk** (see Auth), and its organizations feature is what models clinics and doctors. Never add a users table, a password field or a session cookie of our own.

If a request seems to need something on the not-built list, say so before building it.

## Phase 2 scope

Phase 2 is the clinic dashboard: logins, clinics, doctors, permissions, real video hosting. It also adds **`app/pulse`**, the Pulse 3D master dashboard (see the four surfaces above).

**Decided: self sign-up with card payment.** Solo (1 surgeon) and Clinic (2 to 10 surgeons) sign themselves up and pay by card. Enterprise (11 or more surgeons, or any hospital) is set up by Pulse from `app/pulse`. The card payment itself is billing work (Phase 3): decided, not yet built.

**Built so far:** a person signs up, creates their clinic (a Clerk organization) at `/onboarding`, answers the surgeon-or-staff question once, and lands on a PENDING clinic that shows "Choose a plan to start" until billing, `npm run db:set-status`, or Pulse staff on `/pulse` makes it ACTIVE. Admins invite people and mark each one Surgeon or Staff in `/admin/people`. Pulse staff set each clinic's plan (categories and surgeon seats) on `/pulse` or with `npm run db:set-plan`; seat limits are not enforced until billing.

### Pricing shape

Pricing is a **ladder by number of categories, per surgeon seat**: one monthly price per seat for one category, another for two, and so on, whichever categories they are (defaults $59 / $89 / $109 / $125 / $139 for one to five). A clinic is charged the ladder price for the number of categories it takes, times its surgeon seats; a year is charged as a set number of months. Office staff are never charged. **Decided by Evan on 2026-09-11 (the record is at the top of `lib/pricing.test.ts`): the rounded ladder is the product, to the cent.** There are no per-category prices: a count-based price makes the identity of the categories irrelevant, and a price of a category's own would be a second pricing mode to decide on before it is built. **The ladder never goes down** (decided by Evan on 2026-09-12): each rung is at least the rung before it, equal rungs allowed, and `validatePricingConfig()` refuses a ladder that breaks this, so it can be neither saved nor activated. The numbers are placeholders to edit on `/pulse/pricing`; the model is settled.

- **The engine is `lib/pricing.ts`**, pure and safe for the browser. `quote(config, input)` returns exact whole cents. The one rounding is the per-seat amount for the interval, after the founding offer if there is one, and the total is that times the seats; Stripe will be given that per-seat amount as the unit price. The monthly equivalent of a yearly price is for display only and is never charged.
- **The numbers live in `PricingVersion` rows, never in code.** `getActivePricing()` in `lib/db/pricing.ts` is the only way to read them, and `getPricingForClinic(clinicId)` uses the clinic's pin when it has one. With no active version it returns `DEFAULT_PRICING_CONFIG` marked as an estimate; checkout must refuse an estimate and insist on a saved version. Never write a price literal anywhere but those defaults.
- **The full library** (taking `fullLibraryFrom` categories, 5 by default) is charged at that count's ladder price and includes every category. It is only offered while every category is for sale; otherwise a clinic taking that many pays that count's price for, and gets, just those, and the quote says so. `selectedCategories`, `chargedCount` with `chargedCategories`, and `entitledCategories` are separate things and stay that way.
- **Solo, Clinic and Enterprise** come from the seat limits on the config (defaults 1 and 10) and the practice type the quote is asked with. A hospital is always Enterprise, with no self-serve amount, and is never guessed from a name.
- **The founding offer is 0 by default.** A number modelled on the calculator is not an offer to a customer. A real one needs a written rule for who qualifies and for how long, before checkout is built.
- `listSellableCategories()` decides what a NEW purchase may include. It never removes a category a clinic already has; Pulse staff can grant one early on the clinic's Plan form, where a category that cannot be bought is labelled Not for sale or Coming soon.
- **A quote shown to a clinic is recomputed on the server** from the clinic's own plan and the pricing version the server chooses (rule 8). Nothing the browser sends decides a price.

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
- **A category with no published video shows "Coming soon" in the library** (a dimmed tile with no link, and the same message on its own page) and is not offered for sale. The sentence on the tile is the category's `comingSoonText` from `CategoryConfig`, or the default. A category is offered for sale only while its `sellable` switch is on; `listSellableCategories()` in `lib/db/category-config.ts` is the one list billing and the plan screens should offer.
- **A placeholder video carries its mark everywhere it appears**: the library card, the player, the Send result, the printed pamphlet, the patient page, the admin lists, and any surface added later. Swapping in the real file is an edit to the same row, never a new row, so share links and QR codes keep working. Unticking "Placeholder" on `/pulse/videos` asks for a yes first, because links already sent start playing the new file at once.
- **A video with a `posterUrl` shows it on the library card**; without one, the card shows the video's own first frame, and the branded fallback if that cannot load.
- **Settings come from `getSettings()` in `lib/db/settings.ts`, never constants.** Expiry days and limits are one AppSettings row, read at request time. Prices are not settings: they are pricing versions, read through `getActivePricing()` (see Pricing shape). `getSettings()` returns the code defaults when the row does not exist, so nothing depends on it having been saved. A clinic can carry its own override for a setting (`Clinic.viewDaysOverride` today); read the clinic's value first, then the platform's. Never put one of these numbers in a page or a constant. (`lib/expiry.ts` still holds `SHARE_EXPIRY_DAYS` from Phase 1; it moves onto the settings row when the 7-days-from-first-view expiry is built.)
- **Access is decided in one function each, on the server, and every mutation rechecks it.** Whether a clinic may use the app at all: `clinicIsOpen(status)` in `lib/clinic-status.ts` (today: ACTIVE only; a grace period or pausing changes that one function). Whether a person is an admin: `isClinicAdmin()`. Whether a clinic can use a video: `canUseVideo()`. Whether someone can open `/pulse`: `isPulseStaff()`. Pages call these and never re-implement any check, and a Server Action calls the same function again rather than trusting that the page did.

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
| Payments | **none until Phase 3** | |

### Auth

Clerk guards the staff surfaces. The patient surface is never behind it.

- **`/admin`, `/library`, `/pulse` and `/onboarding`, and everything under them, need a signed-in user.** `/watch`, `/q`, `/api/webhooks`, `/sign-in`, `/sign-up` and static files are always public. The list of guarded prefixes lives in `proxy.ts` (Next.js 16's name for the middleware file).
- **`proxy.ts` is a convenience, not the security boundary.** It sends signed-out visitors to `/sign-in` and back again. Clerk's guidance is that every page, Server Action and Route Handler that reads protected data checks for itself, so: staff pages call `requireClinicPage()` first (which calls `await auth.protect()`); actions and handlers rely on `getCurrentClinicId()` returning null. Keep both layers.
- **A clinic is a Clerk organization, and the Clinic row is created on first use.** `getCurrentClinic()` in `lib/clinic.ts` reads the signed-in user's membership in their active organization from Clerk (one call per request, cached), then upserts the Clinic row keyed on `clerkOrgId` (`upsertClinicForClerkOrg()` in `lib/db/clinics.ts`): the first visit creates it with status PENDING, later visits copy a changed name or logo. No webhooks. It is the only place the signed-in user meets the database. **A Clerk organization id (`org_...`) is not a clinic id** and must never be passed to a `lib/db` function that takes a `clinicId`.
- **`requireClinicPage()` is what every staff page calls first.** Signed out goes to `/sign-in`; no organization goes to `/onboarding` (Clerk's CreateOrganization form, or the list of organizations they were invited to); surgeon question unanswered goes to `/onboarding/kind`. It returns the clinic (id, name, status, logoUrl, kind, isAdmin). Each page then checks `clinicIsOpen(clinic.status)` and shows `<ClinicClosed />` if not; admin pages also check `clinic.isAdmin` and show `<AdminsOnly />` if not. Never crash, never a blank page. **The exception is `/admin/billing`**: an admin of a closed clinic must reach it, so it checks `isAdmin` but not `clinicIsOpen` (see the four surfaces).
- **`getCurrentClinicId()` is for Server Actions and Route Handlers.** A database lookup, no call to Clerk. It returns the clinic id only when the clinic is open, otherwise null, and actions return a plain message on null. A billing action that has to work for a closed clinic will need its own lookup that checks the admin role and skips the open check; it must not loosen this one.
- **`npm run db:link-clinic -- <clinicId> <orgId>`** still exists for a clinic created before its organization (the test clinic was). Clinics that sign themselves up never need it.
- **`CLINIC_ID` is retired.** Nothing reads it. Remove it from `.env` and from Vercel.
- **Clerk's provider wraps only the staff side** (`StaffClerkProvider` in the layouts of `app/library`, `app/admin`, `app/onboarding`, `app/sign-in` and `app/sign-up`). Never put it in the root layout: that would load Clerk's script on every patient's phone. `auth()` on the server works without it.
- The sign-in and sign-up paths, `/sign-in` and `/sign-up`, are set in code in three places that must agree: `proxy.ts`, `StaffClerkProvider` and the `<SignIn path>` / `<SignUp path>` props. No `NEXT_PUBLIC_CLERK_*_URL` variables are used.
- Clerk dashboard settings this depends on: Organizations enabled, and "Allow users to create organizations" on (so a new sign-up can set up a clinic).
- Clerk treats a session that still has a task to finish (such as choosing an organization) as signed out. The prebuilt `<SignIn />` component walks the user through that step itself.
- Keys: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, in `.env` and in Vercel (Production and Preview). Rule 7 applies.

### Roles

Every person in a clinic has a **permission** (role) and a **kind**. They are separate things and stay separate.

**Permission is the Clerk organization role.** Clerk's free plan has exactly two roles and we use only those (custom roles are a paid add-on):

| Role | Who | Can |
|---|---|---|
| `org:admin` | The office admin | `/admin` and everything under it: share links, cancelling any link, QR codes and pamphlets, `/admin/people` (invite, change roles, remove, mark Surgeon or Staff), branding and billing when they exist. Plus everything a member can do. |
| `org:member` | A surgeon, or anyone else on the team | `/library`, and sending links to patients from it. |

The person who creates the clinic is its first admin. Admins invite the rest and choose each person's role in Clerk's panel on the People page.

**Kind is what a person is for billing:** `surgeon` (a seat the clinic pays for) or `staff` (free). It lives on the Clerk membership's public metadata as `{ kind: "surgeon" | "staff" }`, is asked once at `/onboarding/kind`, and can be changed by an admin on the People page. **Kind never grants a permission.** An admin can be a surgeon; a member can be staff.

**Check permission on the server, in every page and every action**, with `isClinicAdmin()` from `lib/roles.ts` (which uses Clerk's `has({ role })`). Hiding a button or an icon is a courtesy, never the check. A member who opens `/admin` sees "This page is for your clinic's office admins."

The helpers live in `lib/roles.ts` (roles, kind, `isClinicAdmin()`) and `lib/people.ts` (list the people in a clinic, set a person's kind; talks to Clerk, never to `lib/db`).

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

Seven models and three enums. If a task seems to need an eighth model, stop and ask.

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
  status     ClinicStatus @default(PENDING)     // changed by billing, by npm run db:set-status, or by Pulse staff on /pulse
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
  viewDaysOverride Int?                         // days a patient link works after first view, instead of AppSettings.viewDays
  phone            String?                      // the clinic's phone, stored as digits only; see lib/phone.ts
  categories       Category[] @default([])      // the categories on the clinic's plan; empty means none yet
  surgeonSeats     Int        @default(0)       // surgeon seats the clinic pays for
  shares           Share[]
  clinicNotes      ClinicNote[]

  // The pricing version this clinic is pinned to, once it has a subscription
  // (billing sets it). Empty means the active version. Activating a new
  // version never changes a pin: a clinic keeps the prices it signed up at.
  pricingVersionId String?
  pricingVersion   PricingVersion? @relation(fields: [pricingVersionId], references: [id], onDelete: Restrict) // a pinned version cannot be deleted; a pin is never silently lost
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
  unclaimedDays Int      @default(90)   // days a patient link works if nobody ever opens it
  viewDays      Int      @default(7)    // days a patient link keeps working after the first view
  graceDays     Int      @default(14)   // days a clinic keeps access after a missed payment
  qrDailyFlag   Int      @default(200)  // scans of one QR code in a day that get flagged for a look
  updatedAt     DateTime @updatedAt
}

model Share {
  id           String    @id @default(cuid())
  code         String    @unique                // short random string in the URL, e.g. k7m2xq
  clinicId     String                           // the tenant column. Always filter by it.
  clinic       Clinic    @relation(fields: [clinicId], references: [id])
  videoId      String
  video        Video     @relation(fields: [videoId], references: [id])
  expiresAt    DateTime
  createdAt    DateTime  @default(now())
  viewCount    Int       @default(0)
  lastViewedAt DateTime?

  @@index([clinicId])
}
```

**Why `Clinic` existed in Phase 1 when there was only one of them.** Adding a tenant column to a table that already holds real customer data is a migration plus a hunt through every query for the ones that forgot to filter. Adding it early cost one table and one column. This is the single most important scale decision in the project.

**Clinic status.** A clinic is created PENDING and only ACTIVE clinics get in. Until billing exists, Pulse staff switch a clinic on from its page on `/pulse`, or with `npm run db:set-status -- <clinicId> ACTIVE`. Never change a status by hand in Neon. A closed clinic's issued patient links keep working until they expire (see "Nothing breaks while the library fills up").

**The clinic log.** `ClinicNote` is the history of a clinic as Pulse sees it: notes staff type (kind STAFF), and entries the app writes when something changes (kind STATUS, named for the first such change and shown as "Change"). **Every change staff save on a clinic's page writes an entry: status, plan, managed by Pulse, and each detail field**, saying what it was and what it became, under the staff member's name. The change and its entry go in one transaction (`changeClinicWithLog()` in `lib/db/clinics.ts`), so the current state and the history cannot disagree, and a save that changes nothing writes nothing. Entries are only ever added. When billing changes a status later, it writes the same pair under its own name. If you add a new thing staff can change about a clinic, write it through the same helper so it is logged too. Nothing in the log is ever shown to the clinic.

**Clinic plan.** `Clinic.categories` and `Clinic.surgeonSeats` are the plan. Set on `/pulse` or with `npm run db:set-plan -- <clinicId> --categories all --seats 10`. Nothing enforces them yet; that comes with billing and category entitlements. On the clinic side the plan is shown in one place, `/admin/billing`, read through `getClinicPlan()` (categories, seats, managed by Pulse, and nothing internal). Do not put plan or pricing information on `/admin` (the overview) or `/admin/links`.

**Pricing versions.** Saving on `/pulse/pricing` adds a `PricingVersion` row; nothing ever edits one. Making a version active is the only update the table sees, done in one transaction under the unique constraint on `active`, so two activations at once still end with one active version. The page asks before it does so (the confirmation names the version and says that new quotes and unpinned clinics move to it); that is a courtesy, and the server gate plus the constraint are the protection. The history list is bounded, so the page hands the editor the active config on its own, from `getActivePricing()`, never by looking for it in the list: the editor must open on the version the page says is active. A stored config that fails `validatePricingConfig()` (a hand edit in Neon) cannot be activated, and reading it as the active or a pinned version is a loud `PricingError`, never a quiet switch to other prices. A clinic's pin (`Clinic.pricingVersionId`) is set by billing later; nothing on `/pulse` sets one yet.

**The name and logo sync.** On every sign-in `upsertClinicForClerkOrg()` copies the organization's name from Clerk, and its logo when Clerk has one. A logo set by Pulse staff survives when the organization has no logo of its own. A name changed on `/pulse` is written to the Clerk organization as well (`lib/organization.ts`), so it does not change back.

**Neon needs both URLs.** `DATABASE_URL` is the pooled connection the app uses; `DIRECT_URL` is the unpooled one Prisma needs to run migrations. Leaving `directUrl` out causes migrations to fail in ways that are hard to read.

**Placeholder videos.** A video with `isPlaceholder` true carries a real procedure name but plays a sample animation, so the library can be tested before the finished animations exist. This is not the same as unpublished: placeholders are visible on purpose. The app marks them everywhere they appear: an amber "Placeholder" mark on the library card, in the player, across the top of the patient page, and in the admin lists. The Send result and the printed pamphlet must carry it too; they do not yet (review checklist item A2), and the first task that touches either adds it. **If you show a video somewhere new, carry the mark with it.** Placeholders are added, edited and replaced on `/pulse/videos` like any other video; `prisma/seed-placeholders.ts` only fills a fresh database, and `prisma/seed-video.ts` (the first real animation) never touches them.

**What `viewCount` means.** It counts play starts on the patient page, one per page load that presses play, for a published video. It is not unique patients, not completed watches, and not evidence that anyone understood anything (see Writing copy). Any number derived from it is labelled by what it actually measures.

---

## Folder map

```
app/watch/[code]     The patient viewer. Phone-first, no login, no navigation.
app/library          The surgeon's exam-room browser. Tablet-first. Browse, play, send.
app/admin            The clinic admin area. /admin is the office manager's overview (page.tsx); AdminFrame.tsx is the frame every admin page draws itself in.
app/admin/links/     Shared links, the complete workspace: ShareLists.tsx (the two lists and their filters), CreateShareForm.tsx, CancelShareButton.tsx, and actions.ts (the create and cancel Server Actions).
app/admin/print/     The printable pamphlet for one share link.
app/admin/qr/        The QR code image for one share link.
app/admin/people/    The People section: everyone in the clinic, Surgeon / Staff on each, Clerk's invite and role panel. Admins only.
app/admin/billing/   Billing: the plan and its estimate. billing.ts works the view out on the server; page.tsx turns it into words. Open to an admin of a closed clinic.
app/admin/reports/   A placeholder until clinic reporting is built.
app/onboarding       Set up your clinic (Clerk's CreateOrganization), then the surgeon-or-staff question at /onboarding/kind.
app/pulse            The Pulse 3D master dashboard. Pulse staff only. The clinics table at /pulse; actions.ts holds every Server Action; ui.tsx the shared pieces.
app/pulse/clinics/   One clinic behind a row of pills (ClinicTabs.tsx): overview, plan, details, people, links, notes. forms.tsx holds the client forms.
app/pulse/settings/  The AppSettings form.
app/pulse/videos     The catalogue: every video in a table with filters, plus the Categories panel (CategoryConfigForm.tsx). new/ adds a video, [id]/ edits one; both use VideoForm.tsx.
app/pulse/pricing    Pricing: the editor, the live calculator and the version history, all in PricingEditor.tsx. Saving and Make active go through actions.ts.
app/pulse/reports    Placeholder page until Reports is built.
app/pulse/FormBits.tsx   Outcome and SaveButton, the two pieces every dashboard form ends with.
app/sign-in          The staff sign-in page, Clerk's prebuilt <SignIn /> component.
app/sign-up          The staff sign-up page, Clerk's prebuilt <SignUp /> component. A new account is sent on to /onboarding.
proxy.ts             Clerk's middleware. Sends signed-out visitors of /admin, /library, /pulse and /onboarding to /sign-in.
lib/db/              EVERY database query. Nothing else touches Prisma. clinics.ts holds the organization-to-clinic lookup, the first-use upsert, getClinicPlan() for /admin/billing, and the Pulse-side reads and writes. shares.ts holds every share-link query, including the overview's summarizeSharesForClinic() and listRecentSharesForClinic(). settings.ts holds getSettings() and saveSettings(). notes.ts holds the clinic log. videos.ts holds the clinic-side published-only lists and the Pulse-side catalogue (listVideosForPulse, createVideo, updateVideo). category-config.ts holds the per-category rows, comingSoonSentence(), getCategoryAvailability() and listSellableCategories(). pricing.ts holds the version store: listPricingVersions, createPricingVersion, activatePricingVersion, getActivePricing, getPricingForClinic.
lib/admin-nav.ts     The sections of the clinic admin area and activeAdminSection(), the rule for which one an address belongs to. Pure; AdminNav renders from it.
lib/pricing.ts       The pricing engine: the config type and its validator, quote(), the built-in defaults, and the dollar and percent reading and writing. Pure, no database, safe for the browser. Never a price literal anywhere else.
lib/pulse.ts         isPulseStaff() and requirePulseStaff(). The one gate for /pulse.
lib/phone.ts         US phone numbers: normalizeUsPhone() to ten digits for storing, formatUsPhone() for showing.
lib/organization.ts  renameClerkOrganization(). Writes a clinic's new name back to its Clerk organization.
lib/video.ts         getPlaybackUrl(). The only place a video URL is built. describeVideoSource(), the "CDN" (later "Mux") word on /pulse/videos.
lib/clinic.ts        getCurrentClinic() (creates the clinic on first use, syncs name and logo), getCurrentClinicId() for actions, requireClinicPage() for pages. The one place the signed-in user meets the database.
lib/clinic-status.ts clinicIsOpen(status). The one place that decides whether a clinic may use the app.
lib/roles.ts         The two Clerk roles, kind, isClinicAdmin(). See Roles.
lib/people.ts        The people in a clinic, from Clerk: listPeople(), setPersonKind(). Never touches lib/db.
lib/share-link.ts    watchLink() and qrFileName(). The only place a patient link is built.
lib/base-url.ts      getBaseUrl(). The site's own address, read from the request, so links work on any deployment.
lib/qr.ts            QR codes for share links, as PNG (download) or SVG (print).
lib/brand.ts         The logo address.
lib/format.ts        formatDuration(), seconds as "4:12" for the staff screens. describeDuration(), "About 2 minutes" for the patient page. parseDuration(), "4:12" typed on /pulse/videos back into seconds.
lib/expiry.ts        SHARE_EXPIRY_DAYS. How long every share link works. The only place that number lives.
prisma/              Schema, migrations, and the scripts: seed, seed-video, seed-placeholders (both for a fresh database only; the catalogue is edited at /pulse/videos), link-clinic, set-status, set-plan.
components/ui/       Shared buttons, cards, layout. AppShell is the banner and rail around the library and admin (its admin icon shows only for admins). AdminNav is the row of section links on every admin page. PulseShell is the same for /pulse. StaffClerkProvider, ClinicClosed (clinic not open) and AdminsOnly (a member on an admin page) are the auth pieces. styles.ts holds the shared button and form-field looks.
vitest.setup.ts      Points the tests at the testing database and refuses to run against production. The decision itself is vitest.guard.ts, a pure function with its own tests.
.claude/skills/      Two process skills Claude loads here automatically: verification-before-completion, systematic-debugging. See its README. Never put .ts files under .claude/.
```

---

## Tests

`npm test` runs Vitest. Tests live next to the code they cover (`lib/db/clinics.test.ts` covers `lib/db/clinics.ts`; `lib/db/videos.test.ts` covers the catalogue; `app/pulse/actions.test.ts` covers the dashboard's actions; pure rules such as `lib/clinic-status.ts` and `lib/format.ts` get a plain test with no database) and hit a real database: the Neon branch called `testing`, whose pooled connection string is `TEST_DATABASE_URL` in `.env.test` (gitignored, like `.env`). `vitest.setup.ts` points Prisma at it, and **refuses to run unless it can show that is not production**: the decision is in `vitest.guard.ts` (which has its own tests) and it fails closed. The test string and every production string that is set must be readable, at least one production string must be set so there is something to compare against, and the test string may not name the same Neon endpoint as `DATABASE_URL` or `DIRECT_URL`, pooled or direct (Neon's `-pooler` address and the direct address of one endpoint count as the same database). That refusal is never bypassed, disabled or loosened to make a test run.

- Tests must pass before any pull request that touches `lib/db`.
- **Tests create their own rows and delete them by id afterwards. They never touch, reset or overwrite rows they did not make.** A table with one shared row (AppSettings) is tested against an in-memory stand-in for the Prisma client instead (`lib/db/settings.test.ts`), because there is no row a test could call its own; a test that wants to see "the defaults" never deletes the real row to get them.
- `vitest.guard.test.ts` exercises the guard with **made-up connection strings only**. No test, log line or error message ever prints a real connection string, not even the rejected one; a refusal names the variable, never the value.
- `lib/pricing.test.ts` is the price fixtures, pure, and carries the record of the pricing decision. `lib/db/pricing.test.ts` hits the real testing database, and because only one version can be active in the whole table, it remembers which one was active when it started and makes it active again at the end. `lib/db/pricing.defaults.test.ts` uses an in-memory stand-in for the empty-installation and damaged-active-version cases, for the same reason the settings test does.
- Tests in `lib/db` never need Clerk. A gate or an action that reads the signed-in user (`lib/pulse.test.ts`, `app/pulse/actions.test.ts`, `app/admin/links/actions.test.ts`) replaces Clerk with `vi.mock("@clerk/nextjs/server")` and plays a staff member, an admin, a member or an ordinary user. A whole route can be rendered the same way (`app/admin/pages.test.tsx` renders the overview, Shared links and Billing with `renderToStaticMarkup`, Clerk's client pieces and `next/navigation` replaced), which proves what each kind of person is shown; clicking is still checked on the preview.
- **What a test suite for a change covers:** the permission boundary (signed out, member, admin, another clinic, Pulse staff, whichever apply), tenant isolation (one clinic cannot read or change another's rows), invalid input, the failure path, a forced overlap where two writes can race, and the behavior that existed before the change.
- After any schema migration, apply it to the `testing` branch with `migrate deploy` (step 2 of "How a schema change ships", under rule 3) before running the tests. Never reset the testing branch to catch it up: a reset copies production's rows into it and throws away whatever the tests had there. If Evan wants a reset, he does it himself.
- Tests are not part of the Vercel build and not a required GitHub check yet.

## Design

Match the live Pulse 3D site. Do not invent a new palette.

- Font: **Inter**, everything
- Accent: `#2a829b` · Accent deep: `#1e5668` · Accent bright (on dark): `#5fb8d4`
- Light band: `#e4ebf3` · Black: `#000000`
- Body text on dark: `#bfbfbf` · Muted: `#667085`

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
