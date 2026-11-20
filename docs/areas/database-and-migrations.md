# The database and migrations

Moved out of the root `CLAUDE.md` in November 2026, word for word except where the pull request that moved it says otherwise.
A section name in quotes ("Billing state", "Roles") is a heading in one of the files under `docs/areas/`; the index at the end of the root `CLAUDE.md` says which.

**`prisma/schema.prisma` is the source of truth for the schema.**
The rules file used to carry a hand-made copy of it; that copy was removed because it drifted.
Its explanatory comments that are not in `schema.prisma` itself are kept below, under "Notes kept from the old copy of the schema".

## Rule 3, in full: never change the database schema unless explicitly asked

The root `CLAUDE.md` keeps a summary of this rule.
This is the whole of it.

`prisma/schema.prisma` is the foundation everything else sits on.
If a task seems to need a new column, table or relation, **stop and say so first.**
Never rename or delete an existing field.
A change that is approved is **additive**: a new column has a default or is optional, and existing rows and fields are preserved.
Anything else needs its own written migration plan, approved separately.

**Never change the database by hand in the Neon console.**
Every change is a Prisma migration, committed to git.
Hand edits break migration history in ways that are painful to unwind.

**How a schema change ships: production last, on Evan's word.**
A git revert does not undo a migration, so the production database is the one thing a pull request must never change before it has been reviewed and released.
The order is:

1. **Write the migration without connecting to production.
   Preferably without connecting to anything.**
   Save the schema as it is on `main` (`git show main:prisma/schema.prisma > <scratch>/schema.old.prisma`), edit `prisma/schema.prisma`, then have Prisma diff the two files: `npx prisma migrate diff --from-schema-datamodel <scratch>/schema.old.prisma --to-schema-datamodel prisma/schema.prisma --script`.
   Put that SQL in a new folder, `prisma/migrations/<UTC timestamp>_<what-it-adds>/migration.sql`, and **read it** before going on.
   If a task genuinely needs `migrate dev` (to rehearse the SQL against a real database), it may only run with `DATABASE_URL` and `DIRECT_URL` pointed at an explicitly identified development database (the `testing` branch, or a throwaway Neon branch made for the purpose) plus a separate disposable shadow database, both named in the PR.
   **`--create-only` is not a safety boundary**: it still connects, and a second run applies the pending draft.
   The main checkout's `.env` is the `testing` branch, which every preview and the demo site share (production's strings are in `.env.release`; see "Where production's connection strings live" below), so `migrate dev` never runs there, with any flag, and there is no npm script for it (the old `db:migrate`, which was `prisma migrate dev`, was removed in October 2026 for that reason; a test fails if any npm script runs `migrate dev`, `migrate reset`, `migrate deploy` or `db push`).
2. **Apply it to the `testing` branch and run the tests.**
   From the main checkout, whose `.env` is the testing branch, that is plain `npx prisma migrate deploy`; from a worktree or anywhere else with no `.env`, `DATABASE_URL=<testing pooled> DIRECT_URL=<testing direct> npx prisma migrate deploy`.
   Then `npm test`.
   (A Neon branch shares its parent's password, so the direct string is the pooled one with `-pooler` removed from the host.)
   Never reset the testing branch to do this; `migrate deploy` is enough, and a reset throws away what the tests had there.
   On a computer with the local test database (see Tests), apply it there too, the same way with both strings pointed at it: the local copy and the Neon branch are two separate databases, and each one is migrated.
3. **Push and open the pull request.**
   The description lists the migration, its SQL in plain words, any script that changes rows, the order production will be migrated in, why the old code keeps working on the new columns in the minutes between the migration and the deploy, and how it would be recovered if it went wrong.
   Every preview reads the Neon `testing` branch (see "Previews and production are kept apart" under Auth), which step 2 already migrated, so the preview has the new columns: check the preview page that uses them.
   Every open preview shares that one database, so the migration is there for all of them at once, which is safe because a migration only adds.
4. **Evan reads the summary and then says whether to release.**
   Reading it is the review; it is not the release.
   **Nothing touches production until Evan gives an explicit instruction after that review**: not the migration, not a data script, not a vendor setting, not the merge.
   When he does, apply the migration to production with `npm run on-production -- npx prisma migrate deploy` from the main checkout (it takes production's strings from `.env.release`, prints which database it is about to use, and runs the command; `migrate deploy` is the one deployment command, never `migrate dev`, never `migrate reset`, never `db push`), run any data script, add the `production-migrated` label to the pull request (the "Production migration" check waits for it; see "Automatic checks"), and then merge.
   Production is migrated right before the merge, not after it, because the new code expects the columns the moment Vercel deploys `main`; the old code ignores columns it does not know, so the minutes between the migration and the merge are safe.
5. **Point-in-time restore must be on for the production branch** (Neon, project settings, history retention) before any production migration.
   Check it once; it is the undo button.

A migration that turns out wrong is fixed forward with another migration that only adds.
An applied migration is never edited, never deleted from the folder, and never rolled back by hand.

## The database

Fourteen models and nine enums (the tenth, `Category`, became plain text in K2, approved by Evan on 2026-10-24; see "Categories are text" below; `QrCode` was the thirteenth, approved by Evan on 2026-10-08 for Prompt 9; `PersonalVideo` the fourteenth, approved by Evan on 2026-10-15 for the library rows).
If a task seems to need a fifteenth model, stop and ask. (`Video` and `Clinic` also list `personalVideos PersonalVideo[]`: a back-reference Prisma needs, with no column of its own.)

**Setup progress (`Clinic.setupStep`, `Clinic.setupDone`, migration `20261119180000_add_clinic_setup_progress`, approved by Evan on 2026-11-18).**
Two additive columns on `Clinic`, no new model: `setupStep` (optional text: the step to come back to, or "finished") and `setupDone` (a list of the steps completed, empty by default).
Every clinic that existed before the migration has `setupStep` empty, which the app reads as set up, so no clinic already open is asked to go through setup and no data script is needed; a clinic gets "clinic" when its row is first made (`upsertClinicForClerkOrg()`).
The same empty value is how the owner's automatic seat tells a clinic made before the 2026-11-19 rule from one made after (see "Surgeon seats").
They are written only by `recordSetupStep()` in `lib/db/setup.ts`, under the clinic's row lock, never moving backwards.

**Why `Clinic` existed in Phase 1 when there was only one of them.**
Adding a tenant column to a table that already holds real customer data is a migration plus a hunt through every query for the ones that forgot to filter.
Adding it early cost one table and one column.
This is the single most important scale decision in the project.

**Clinic status.**
A clinic is created PENDING.
`Clinic.status` is the clinic's **effective** status and is never written on its own: it is worked out from what staff set by hand, whether Pulse manages the clinic, and its billing record (see "Billing state"), and rewritten in the same transaction as whichever of those changed.
Pulse staff open, pause or cancel a clinic by hand from its page on `/pulse`, or with `npm run db:set-status -- <clinicId> ACTIVE` (also PAUSED, CANCELED, or FOLLOW to remove the hand setting); both go through `setClinicStatusByStaff()`. Never change a status by hand in Neon.
A closed clinic's issued patient links keep working until they expire (see "Nothing breaks while the library fills up").

**Operator scripts (`npm run db:*`) refuse production unless told.**
They load `.env`, which on the main checkout is the testing branch, but a `DATABASE_URL` already set in the environment wins over the file (that is how `npm run on-production` reaches production), so every one of them calls `preflight()` (`prisma/preflight.ts`) before its first query.
It prints the database's host name (never the connection string) and refuses to run when that is the production database, unless `--production` is on the command line after the `--` (`npm run db:set-status -- <clinicId> PAUSED "reason" --production`; before the `--`, npm takes the word for itself and the script refuses).
On production a script is run through the release command, with the word as well: `npm run on-production -- npm run db:set-status -- <clinicId> PAUSED "reason" --production`.
Given on its own, against the testing branch, `--production` is refused, as it is for any database that is not production.
Production is recognised by `PRODUCTION_DATABASE_HOST` in `.env`, the host name of the production database with no user or password, compared the way the test guard compares (both reduced to one form first: pooled and direct count as the same database, and so does a host written with a port, a trailing dot or capitals).
**It fails closed:** with that line missing or unreadable every database counts as production, and `--production` given for a database that is clearly not production is refused, because the flag or the line is wrong.
A new script that touches the database calls `preflight()` first, and `prisma/preflight.test.ts` fails if one does not.
Failures print the kind of error (`errorKind()`), or our own plain refusal sentence, never the error object.

**Where production's connection strings live (decided by Evan on 2026-11-18).**
On the main checkout, `.env` holds the `testing` branch's `DATABASE_URL` and `DIRECT_URL`, so anything run without thinking (the app on this computer, a Prisma command, an operator script) reaches the testing branch.
Production's two strings live in `.env.release`, next to it and ignored by git the same way, and nothing reads that file except `npm run on-production -- <command>` (`prisma/release-env.ts`; the check is `planRelease()` in `prisma/release-plan.ts`, with its own tests).
That command refuses unless `.env.release` holds both strings and both name the database `PRODUCTION_DATABASE_HOST` names, prints the production host (never a connection string), and runs the command with the two strings set.
The file is never named `.env.production`: Next.js loads a file of that name by itself on every production build.
Why: until this change `.env` was production, so a database command that forgot its own setting ran against production; on 2026-11-18 a `migrate deploy` did exactly that (nothing was pending, so nothing changed).
`PRODUCTION_DATABASE_HOST` stays in `.env`: it is how the operator scripts, test-mode checkout and the test guard recognise production.
**A session working in a worktree still names its database on the command line** (`DATABASE_URL=... DIRECT_URL=...` in front of the command) and stops if the host is not the one it meant; the safe default is a second line of defence, not a reason to drop the first.

**The demo clean-up (`npm run db:clear-demo-clinics`, `prisma/clear-demo-clinics.ts`, decided 2026-11-18) is the one operator script with no `--production` at all.**
It clears the clinics sales demos leave on the demo site from our database, Clerk and Stripe, and keeps the showroom clinic.
It reads `.env.demo`, never `.env`: the demo site's `DATABASE_URL` (the `testing` branch), its `STRIPE_SECRET_KEY`, its `CLERK_SECRET_KEY`, `PRODUCTION_DATABASE_HOST`, `DEMO_DATABASE_HOST` and `DEMO_STRIPE_ACCOUNT_ID` (a `DATABASE_URL` already set in the shell beats the file, so open a fresh terminal).
**The database is checked both ways:** refused when it is production or cannot be told apart from it (the deny check every script makes), and refused unless it is the database `DEMO_DATABASE_HOST` names (an allow check, so one wrong hand-copied host cannot make production look safe); neither value is ever printed.
**A Stripe test key is not enough on its own:** production also runs on a test key until launch and may share the sandbox, so the script refuses to start unless the key belongs to the Stripe account `DEMO_STRIPE_ACCOUNT_ID` names (asked of Stripe first), and it touches no customer or subscription unless Stripe's own record carries that clinic's id in its metadata (`clinicId`, written at checkout); a clinic whose Stripe record names another clinic, or none, is skipped whole, with nothing changed in Stripe, Clerk or our rows.
It also refuses when `--production` is given, when Clerk's key is not a test-instance key (`sk_test_`), when no clinic to keep is named (`--keep <id>`, several separated by commas, or `DEMO_KEEP_CLINIC_IDS`), or when a named one is not a clinic.
Clinics made in the last 24 hours (`--hours <n>`) are kept too, so a demo in progress survives.
**It is a dry run unless `--confirm` is given:** it lists each clinic it would clear by name, id and date, with counts, and whether Stripe and Clerk still have its records.
For each clinic, in this order: Stripe (cancel the test subscription, delete the test customer, through `demoCleanupStripe` in `lib/stripe.ts`), Clerk (delete the organization, then each of its people who now belong to no organization and are not Pulse staff, through `lib/clerk-demo-cleanup.ts`, which talks to Clerk's Backend API over plain HTTPS because `@clerk/nextjs/server`, and so `lib/people.ts`, cannot load in a script), then our rows in one transaction holding the clinic's row (`deleteClinicForCleanup()` in `lib/db/demo-cleanup.ts`, which checks the keep list and the age again inside).
The rows deleted are the clinic's `Share`, `QrCode`, `ClinicBilling`, `BillingPlan`, `BillingEvent`, `PersonalVideo`, `ClinicNote`, `SeatAllocation` and `SeatInvitation` rows, then the `Clinic`; the shared tables (`Video`, `CategoryConfig`, `PricingVersion`, `AppSettings`) are never touched.
When Stripe or Clerk fails, that clinic stops there with its rows in place, the run goes on to the next and exits non-zero; already-gone records count as done, so running it again finishes the job.
A Clerk answer it cannot read (no proper count of a person's organizations) stops the clinic rather than deleting the person.
Two limits: a Pulse staff member's account on the Clerk TEST instance is protected only if `pulseStaff: true` is set in that instance's metadata, or they belong to a kept organization; and if a run stopped after deleting the organization, a member our rows never recorded (no seat, not the owner, no hearts or plays) is no longer found and stays in Clerk.
It prints names, ids and counts only.
Because the demo site shares the `testing` branch with every preview, it also clears the clinics previews and test runs leave there, unless they are on the keep list or new.

**Neon needs both URLs.**
`DATABASE_URL` is the pooled connection the app uses; `DIRECT_URL` is the unpooled one Prisma needs to run migrations.
Leaving `directUrl` out causes migrations to fail in ways that are hard to read.

## Notes kept from the old copy of the schema

These comments were in the copy of the schema that this file used to carry, and are not (word for word) in `prisma/schema.prisma`.
They are kept here as they were written, under the model or enum they belonged to.
Where one disagrees with `schema.prisma`, `schema.prisma` wins.
"Below" in them meant further down the old rules file.

```prisma
// above model Video
// The categories used to be a fixed list here (an enum called Category). Since K2
// they are plain text, and the CategoryConfig table is the list of categories that
// exist. The old enum type is still in the database, unused, until a later clean-up
// migration drops it (see "Categories are text" below).

// model Video
  category        String                        // a CategoryConfig row's key ("KNEE"); the foreign key refuses any other

  muxPlaybackId   String?  @unique              // the SIGNED Mux playback id once the video has moved to protected playback. Set, the video plays only through a signed Mux address (lib/playback-auth.ts) and videoUrl is kept as the record of where the file came from, never as a fallback. Empty means the file at videoUrl plays as before

  muxUploadId     String?  @unique              // an upload to Mux in flight for this video (Mux's direct upload id), so the webhook and "Check with Mux" can find the row. Cleared when the asset is ready, cancelled or failed. The video keeps playing what it had the whole time
  chapters        Json     @default("[]")        // the video's chapters, for the library watch page only: a list of { startSeconds, title }, sorted by time, the first at 0. Edited by Pulse staff on /pulse/videos, checked by parseChapterLines() in lib/chapters.ts and read back through readStoredChapters() (anything damaged reads as none). Empty means none. Never shown on the patient page

// model Clinic
  status     ClinicStatus @default(PENDING)     // the EFFECTIVE status, never set on its own: worked out by effectiveAccess() from staffAccess, managedByPulse and the ClinicBilling row, and rewritten whenever one of them changes

  notes            String?                      // the old single notes box. Superseded by ClinicNote; kept, never read (rule 4)

  brandColor       String?                      // optional brand colour; derived shades preserve contrast
  brandFont        String?                      // approved font key; null uses Inter
  brandTheme       String?                      // "light" for light staff screens; null or "dark" means dark. Checked by parseBrandTheme(); the patient page and /pulse ignore it

  // Billing. See "Billing state" below.

  staffAccess  StaffAccess?                     // what Pulse staff set by hand, which always wins over billing; empty means billing decides. Who, why and when are statusChangedBy, statusReason, statusChangedAt
  graceEndsAt  DateTime?                        // only while status is PAST_DUE: the exact moment the clinic closes. Copied from ClinicBilling.graceEndsAt; empty with PAST_DUE means closed

  // Who holds one of the seats above, and which open invitations hold one. See "Surgeon seats" below.

  // The account owner's Clerk user id: always an admin, the one person who
  // needs no seat. Set when the clinic is created, moved by a handoff or by
  // Pulse staff, cleared when the owner leaves. Empty for clinics made before
  // owners existed. See "Roles".

// above enum SeatSyncState
/// From the owner model on, every new seat is SYNCED; PENDING is only found on
/// rows the earlier model wrote, and the seat check marks those SYNCED.

// above model SeatAllocation
/// One seat, held by one person at one clinic. With SeatInvitation, THE
/// AUTHORITY on who holds a paid seat. A row is only ever added inside a
/// transaction that holds the clinic's row lock. Two ids and, optionally,
/// the name patients see on the person's links. No email, no role.

// model SeatAllocation
  clerkUserId String                              // the Clerk user id of the person holding the seat. An id only

  displayName String?                             // how this person's name appears to patients on links they send ("Dr. Jane Smith, DO", "Jane Smith, PA-C"); empty means "First Last" from Clerk (it was "Dr. First Last" until 2026-11-16; this comment in schema.prisma still says the old words, left alone because the schema file is not edited without asking). Set by an admin on /admin/people or by the person from the library's Send panel; built from a name and a credential by lib/sender-name.ts

// above model SeatInvitation
/// One seat held by an invitation not yet accepted. Counts against the plan
/// like a SeatAllocation row and is written under the same lock. The Clerk
/// invitation carries this row's id ({ seatHold: id }); Clerk copies it onto
/// the membership on acceptance, and the seat check turns the hold into the
/// person's seat. Ids only: the email lives in Clerk.

// model SeatInvitation
  clerkInvitationId String?  @unique               // Clerk's invitation id, set once Clerk has made it
  reservedAt        DateTime @default(now())       // a hold Clerk never made an invitation for is let go after a few minutes

// enum PracticeType
  UNKNOWN   // not answered yet: every clinic starts here, including every clinic that existed before billing

// above enum StaffAccess
/// What Pulse staff set by hand. It always wins over what billing says.

// above enum BillingStatus
/// Where a clinic's card subscription stands, as Stripe reports it. The
/// financial record only; whether the clinic is open is Clinic.status.

// enum BillingStatus
  INCOMPLETE  // checkout started, first payment not confirmed. No access comes from this

  PAST_DUE    // a renewal failed; grace runs from the first time this was recorded

// above model ClinicBilling
/// Stripe's side of one clinic. One row per clinic, made when it first starts
/// a checkout. Written only by lib/db/billing.ts, under the clinic's row lock.

// model ClinicBilling
  stripeSubscriptionId String?       @unique     // the ONE subscription this clinic is expected to have. News about any other is ignored

  graceEndsAt          DateTime?                 // paymentFailedAt plus the grace days in the settings at that moment. Fixed once; cleared on recovery

  pendingPlanId        String?       @unique     // accepted at checkout, waiting for the first payment; on a live subscription, an upgrade waiting for its payment (a copy of what Stripe is holding back)

  scheduledPlanId      String?       @unique     // takes over at scheduledChangeAt: a copy of what Stripe's schedule on the subscription says, written only by reconcileSubscription()

  // (the three plan ids are relations to BillingPlan, onDelete: Restrict)

// above model BillingPlan
/// One plan a clinic accepted. Written once and never edited.

// model BillingPlan
  pricingVersionId   String                      // the version it was quoted from; Restrict, so that version can never be deleted

  entitledCategories String[]                    // what it got the day it was accepted (every category when the full library is included). History: a full-library plan is read through includedNow()
  fullLibrary        Boolean  @default(false)    // bought as the full library: it includes every category, ones added later too (Option A, 2026-10-26). False for every plan before it

// enum BillingEventStatus
  FAILED     // the work threw; Stripe was told to send it again

// above model BillingEvent
/// One row per Stripe event id. The unique constraint is what makes a
/// repeated delivery harmless. The body Stripe sent is never stored.

// model BillingEvent
  clinicId             String?            // not a relation: an event can arrive for a customer we do not know

  lastErrorCode        String?            // the KIND of error only, never a message

// model PricingVersion
  billingPlans  BillingPlan[]   // the accepted plans quoted from this version

// model AppSettings
  qrDailyFlag   Int      @default(100)  // links one printed QR code may hand out in a day (from midnight UTC) before it is flagged for Pulse staff (/pulse and the clinic's /pulse page). Always below qrDailyCap. 200 until Prompt M; a row saved before keeps its own number
  qrDailyCap    Int      @default(200)  // links one printed QR code may hand out in a day (from midnight UTC); past it, the patient sees the calm "not available right now" page and nothing is written (Prompt M)

// model Share
  // Who the link is from: a surgeon, never a patient. Both copied when the link is made; empty on links made before surgeons were recorded.

  // Pausing and reactivation (see "How a link expires, pauses, and is turned back on"). Nothing here is about the patient.

  renewalRequestedAt DateTime?                    // when the patient last tapped "Ask my clinic"; one request per link per day. Cleared when the link is turned back on

  renewalRequests    Int       @default(0)         // how many "ask my clinic" requests have been recorded on this link (at most one a day), for the Pulse reports. Only goes up, never reset. Counts from October 2026: 0 on every earlier link

  // The "for education only" box (see "The disclaimer record"). About the link, never about who ticked it. Empty and 0 on every link made before the box.

  disclaimerAcceptances     Int       @default(0)  // one per recorded tick (at most one per page load), like viewCount. Not people
  disclaimerVersion         String?                // the version of the wording ticked most recently (DISCLAIMER.version)

  // The printed QR code that handed this link out, when one did. Empty for every link made by hand.

  @@index([clinicId, createdAt])                   // "links this clinic made since <date>", for the Pulse reports

// above model QrCode
/// A permanent QR code a clinic prints and keeps (see "Printed QR codes").
/// Not a patient link: the patient's tap on Play makes one. At most one live
/// code per procedure per surgeon per clinic. Retired, never deleted; a
/// retired code never works again.

// model QrCode
  code               String    @unique              // 25 random lowercase letters and digits, about 128 bits. A secret like a key: never logged

  senderUserId       String                         // the surgeon's Clerk user id; its links name them while they hold a seat, the clinic only once they do not
  senderFallbackName String?                        // "First Last" from Clerk when the code was made ("Dr. First Last" for codes made before 2026-11-16, kept as they are; the patient page never asks Clerk)
  liveKey            String?   @unique              // "<clinicId>:<videoId>:<senderUserId>" while live, empty once retired: one live code per pair, whatever the timing

  retiredAt          DateTime?                      // set once, when retired or replaced

// above model PersonalVideo
/// they hearted it, and how often they played it there. Per person, never
/// shown as a number anywhere on the clinic side. Staff data only, never about
/// a patient. Written only by lib/db/personal-videos.ts, with one INSERT ...
/// ON CONFLICT, so a repeated or simultaneous heart or play ends in one row.
/// Never deleted when a video leaves the plan: it is hidden, and back when the
/// category is.

// model PersonalVideo
  id           String    @id @default(cuid())        // the app writes a random UUID here (its SQL cannot ask Prisma for a cuid)

  favoritedAt  DateTime?                             // when hearted; empty means not a favorite. Kept on a repeat heart, set again after an un-heart
  playCount    Int       @default(0)                 // library plays: one per player opening, at the first real "playing" event. Never shown
```
