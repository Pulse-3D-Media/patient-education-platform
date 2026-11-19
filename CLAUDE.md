# CLAUDE.md

The rules file for the `patient-education-platform` repository, where it lives as `CLAUDE.md` in the root.
Claude reads it automatically at the start of every session, so it holds only what every task needs: the hard rules, how to work, the four surfaces, the speed rule, copy, design and pull requests.

**The detail for each part of the app lives in `docs/areas/`, one file per area.
Before you edit an area, read its file in full.**
That is required, not optional: the index at the end of this file says which file covers what, and which file each old section name ("Billing state", "Roles", "The video boundary") now lives in.
Some folders also have a short `CLAUDE.md` of their own (`app/watch`, `app/q`, `app/library`, `app/admin`, `app/admin/billing`, `app/pulse`, `lib/db`, `prisma`), which Claude loads when it works there.
Dated decisions, who made them and when, are listed in `docs/decisions.md`.

---

## What this is

The Pulse 3D Patient Education Platform.
Surgical patient education animations, delivered to patients on their own phones.

A clinic creates a share link.
The patient scans a QR code or opens the link, watches an animation explaining their upcoming procedure, and the link stops working seven days after the patient first plays it, or after ninety days if nobody ever does (both numbers are settings; see "How a link expires").

**Phase 1 is done:** create a link, watch a video, link expires.
**We are in Phase 2, the clinic dashboard.**
Built: logins, clinics and people, the Pulse 3D master dashboard, the clinic admin area, clinic branding (device acceptance pending), paused links a clinic can turn back on, calm error pages, error alerts and a health check, billing in steps, real video hosting on Mux, reports for Pulse staff, printed QR codes, and the approved sign-up design up to setup (the landing page, sign-up's plan and payment steps in test mode, the welcome dialog, four setup steps with saved progress, and the join screen for invited people), and the quick tour of the library (its code loads only when it is shown; see `docs/areas/library.md`).
Where each piece stands, and what is still not built, is in `docs/areas/product-scope.md`.
**Billing is built in Stripe test mode only.**
**Nothing real is ever charged: the app refuses a live Stripe key, and test-mode checkout, plan changes and Stripe's billing page are never offered on the production deployment.**

**Do not invent a login system.**
Sign-in is **Clerk** (see Auth), and its organizations feature is what models clinics and doctors.
Never add a users table, a password field or a session cookie of our own.

If a request seems to need something on the not-built list (in `docs/areas/product-scope.md`), say so before building it.

## This repository is public

Deliberate, for now: Vercel's free plan will not deploy a private repository owned by an organization, and we are pre-revenue.
It goes private when we move to Vercel Pro, which will be before launch.

Two consequences while it stays public.
**No secret may ever be committed** (see rule 7, which is the most important rule in this file today).
And anything written here is readable by anyone, so no client names, no unreleased animation stills, and no commercial detail that is not already on the public website.

## Who works on this

**Evan Miller, solo.**
He is a marketer, not a programmer, and builds entirely with Claude Code.
Van Miller (founder) reviews but does not write code.

**Write code that a non-programmer can follow.**
Prefer obvious over clever.
Comment anything that would not be self-evident to someone reading it for the first time.
When there is a simple way and a sophisticated way, take the simple way.
If a task needs a concept he will not have met before, explain it in one plain sentence before using it.

---

## Hard rules

### 1. All database access happens on the server, and only through `lib/db`.

Two parts, both required.

**Server only.**
Read and write data in Server Components, Server Actions or route handlers.
Never send the database connection string to the client.
Never install or use a database client in browser code.

**Only through `lib/db`.**
Pages and components never call Prisma directly.
Every query lives in a named function in `lib/db/`, and **any function that touches clinic-owned data takes `clinicId` as its first argument.**

```ts
// lib/db/shares.ts
export async function createShare(clinicId: string, videoId: string, days: number)
export async function listSharesForClinic(clinicId: string)
export async function getShareByCode(code: string)   // public, no clinic needed
```

**The `clinicId` comes from the server's own check of who is signed in** (`getCurrentClinicId()`, see Auth), never from a form field, a query string or anything else the browser sent.
A clinic id that arrives from the browser is untrusted input, not an identity.

The only functions that take no `clinicId` are the ones behind the patient's link, where the share code in the URL is the key: `getShareByCode()`, `recordSharePlay()`, `requestShareRenewal()` (the patient's one tap on a paused link, which writes one timestamp and adds one to the link's request tally, and nothing else) and `acceptShareDisclaimer()` (the patient's tick of the "for education only" box, which, in one UPDATE that also checks the link is working, sets the first-ticked time once, adds one to the tick count and records the wording's version, and nothing else; added with the disclaimer gate); and the two behind a printed QR code, where the printed code is the key: `getQrCodeByCode()` (reads the code for its page) and `issueShareFromQrCode()` (the Play tap: makes that visit's own link, with the clinic, video and surgeon taken from the code's row and every access check made under locks; added with Prompt 9).
That is the whole list.
If a task seems to need another public-by-code function, say so first.

Why both: in Phase 1 `clinicId` came from a single constant.
In Phase 2 it comes from the signed-in user.
**Because the seam already existed, Phase 2 was a swap, not a rewrite** - and there is exactly one place to check that clinics cannot see each other's data.

### 2. No patient-identifying information, anywhere, ever.

No names, no dates of birth, no email addresses, no medical record numbers, no clinical notes.
A share link is tied to a **procedure**, a **clinic** and the **surgeon** it is from, never to a patient.
No patient profiles, no marketing or advertising tracking on the patient page, and no patient-facing sales features, ever.

The staff side is different: a staff member's identity is used for sign-in, for permissions, for the clinic log and, for a surgeon, as the name on the links they send ("Dr. Jane Smith"), and that is fine.
It is patient data that never enters the system.

**This is a product constraint, not a legal conclusion.**
Storing no patient identifiers keeps the platform simple and is the reason we assume it sits outside HIPAA's scope, but that assumption has not been checked by anyone qualified to check it, and hosting, logging, the video host and any future analytics all receive data too.
Never write, in code, docs, copy or a PR, that the platform "is outside HIPAA" or "is HIPAA compliant".
The honest sentence is: it stores no patient identifiers, and the whole data flow is to be reviewed before any hospital contract.

If a task appears to require storing patient information, **stop and flag it** rather than building it.

### 3. Never change the database schema unless explicitly asked.

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

1. **Write the migration without connecting to production, preferably without connecting to anything:** diff the schema as it is on `main` against the edited `prisma/schema.prisma` with `npx prisma migrate diff`, put the SQL in a new `prisma/migrations/<UTC timestamp>_<what-it-adds>/migration.sql`, and read it.
   `migrate dev` never runs against the main checkout's `.env` (the `testing` branch every preview shares; production's strings live in `.env.release`), and no npm script runs `migrate dev`, `migrate reset`, `migrate deploy` or `db push`.
2. **Apply it to the `testing` branch** (and to the local test database, where there is one) with `npx prisma migrate deploy`, then run the tests.
   Never reset the testing branch.
3. **Push and open the pull request**, which says what the migration does in plain words, the order production will be migrated in, why the old code keeps working in the minutes in between, and how it would be recovered.
4. **Evan reads the summary and then says whether to release.**
   Nothing touches production until he gives an explicit instruction after that review.
   Then: `npm run on-production -- npx prisma migrate deploy` from the main checkout (the one command that reads production's strings, from `.env.release`), any data script, the `production-migrated` label on the pull request, and then the merge.
5. **Point-in-time restore must be on for the production branch** before any production migration.

**The full procedure, with every command and the reasons, is in `docs/areas/database-and-migrations.md`.
Read it before writing a migration.**
The schema has fourteen models and nine enums today (`prisma/schema.prisma` is the source of truth; there is no copy of it in the rules any more).
If a task seems to need a fifteenth model, stop and ask.

A migration that turns out wrong is fixed forward with another migration that only adds.
An applied migration is never edited, never deleted from the folder, and never rolled back by hand.

### 4. Do not remove things that look unused.

Several fields exist for later phases and are deliberately unused right now, including `Video.isPublished` (only ever set by the seed scripts so far).
**They are load-bearing later.
Leave them alone.**

### 5. One task at a time. One prompt is one pull request.

Do the thing that was asked, not the three adjacent things that would also be nice.
If you spot something else worth doing (a bug from a review, an item from the build plan, a tidy-up), say so and wait; it becomes its own prompt and its own PR.
Small changes are reviewable by someone who cannot read code; large ones are not.
**The title and description of the PR describe what it finally contains**, so if the scope moved during the work, rewrite them before asking for review.

### 6. Do not add dependencies casually.

Ask first, and say what the package is for in plain English.

### 7. Never commit secrets. THIS REPOSITORY IS PUBLIC.

Everything sensitive lives in `.env`, which stays out of git.
`.gitignore` must always cover `.env*`.

**The repository is public while we are pre-launch.**
That raises the stakes on this rule considerably:

- A committed database URL or API key is found by automated scanners **within minutes**, not eventually.
- **Git history is permanent.**
  Deleting the file in a later commit does not remove the secret from history.
  Anything committed once must be **rotated**, not just deleted.
- **Never hardcode a connection string, key or token anywhere in the code**, not even temporarily while testing.
  If a value is needed, it comes from `process.env`.

Before any commit that touches configuration, confirm `.env` is still ignored.

**"Secret" is wider than keys.**
None of the following goes into code, test fixtures, screenshots, logs, docs, commit messages or PR text: credentials; a real clinic's private data; anything about a patient (there should be none, see rule 2); a live share link or its code; a signed playback address; a webhook body; unreleased commercial detail.
Test fixtures use made-up values and synthetic connection strings, and nothing ever prints a connection string, not even to say it was rejected.

### 8. The server decides. The browser only asks.

Prices, access, ownership, roles, seat counts and limits are worked out on the server for every request that matters, from what the server itself knows.
A value the browser sends is a request, never a fact: the server recomputes it.
**Hiding or disabling a button is a courtesy, never authorization**, and every Server Action and route handler rechecks who is asking before it changes anything.

- **Writes to what is shared across clinics need Pulse staff.**
  The catalogue, category settings, pricing, platform settings, reporting and anything that manages a clinic from the outside: every such action calls `requirePulseStaff()` first.
  Clinic operations need the right organization role, checked on the server with `isClinicAdmin()` or the clinic lookup.
- **Reject bad input at the edge.**
  An enum value the code does not know, a duplicate, a number that is not finite, a value outside what the column or the business allows, malformed form data: all refused with a plain message, never stored, never guessed at.
- **Client-safe modules never import server modules.**
  A file that runs in the browser (anything under `"use client"`, and any type, constant, validator or calculator it imports) must not import `lib/db`, Prisma, a signing key, Clerk's backend client, the settings row or a clinic's internal notes.
  Put the shared pieces (types, defaults, help text, validators) in a plain module with no server imports, and import that from both sides; `lib/pricing.ts` is the model.
  `lib/settings-defaults.ts` and `lib/categories.ts` hold the pieces the settings and category forms share with `lib/db`.
  **The boundary is enforced, not remembered:** `lib/db/client.ts`, which every file in `lib/db` imports, starts with `import "server-only"`, so the build fails, naming the file, if browser code reaches the database through any chain of imports.
  `lib/stripe.ts`, `lib/email.ts` and `lib/people.ts`, which hold Stripe's, Resend's and Clerk's server-side keys, start with the same guard (`lib/server-boundary.test.ts` checks all four).
  Vitest gets an empty stand-in for the package (`vitest.server-only.ts`), and the scripts in `prisma/` run with `--conditions=react-server` (set in `package.json`), without which the guard refuses to let them start; a new script that loads `lib/db` needs the same flag.
- **Lists and histories are bounded.**
  Any list that can grow (links, notes, videos, clinics, people, events) is read with a limit, paged, or aggregated in the database.
  Never load a whole operational history into a page or the browser.
  On `/pulse` the clinics table and a clinic's notes are read a page at a time (`lib/paging.ts`), searched, sorted and counted in the database, and a clinic's Links tab reads the newest twenty and a count.

---

## Working on a task

### Starting

- **Read before editing:** this file, the area file in `docs/areas/` for what the task touches (required, see the index at the end), `AGENTS.md`, the code the task touches, `prisma/schema.prisma` and the migrations folder, the tests next to that code, and any review notes the prompt points at.
  Look at `git status` and recent history, and preserve work already present: never overwrite a branch, a file or an uncommitted change you did not make.
- **One focused branch from the latest reviewed `main`**, unless the prompt names another base.
  **Branch names are 17 characters or fewer** (Vercel's preview address is built from the branch name, and a longer one gets a hash nobody can guess).
  If the branch already exists, look at what is on it and pick a clear short variant instead of reusing it.
- Say, briefly, what the change will do and how it will be checked, then do the routine in-scope work without stopping for approval.
  **Ask only when the answer is a business decision, when a credential or an access grant is needed, when an action is destructive, or when the scope would grow meaningfully.**
  A guess at a business decision is worse than a question.
- Rule 5 applies: one prompt, one PR.
  Review findings and roadmap items the prompt did not name are reported, not folded in.

### Mutations and outside services

- **A form keeps what was typed when something goes wrong.**
  Validation error, lost connection, a rejected action: the draft stays, a plain sentence says what happened, and there is a way to try again.
  A form is cleared only after the server has confirmed success.
  React empties a form's boxes after every send, so this has to be done on purpose: every form on `/pulse` goes through `useKeptForm()` in `app/pulse/FormBits.tsx`, which declines that reset and turns a save that fails outright into "We could not confirm the save. Your entries are still here. Try again." (`safeSave()` in `lib/form-save.ts`); `BrandingForm` and the note box do the same in their own code.
  A new form with boxes uses the hook, never React's `useActionState` on its own.
  The kind of failure goes to the server log, never to the screen, and the log line holds only words and the kind (`errorKind()` in `lib/error-kind.ts`: a Prisma code, a Stripe type or the class name), never the error object, its message or its stack, because a message can carry a share code or a connection string.
- **A retried mutation must be safe to repeat.**
  A disabled button does not stop a double submit, two open tabs, a flaky connection that resends, or a webhook that retries.
  Design each write so doing it twice gives the same end state: look up by a unique key before creating, catch the unique-constraint error (Prisma `P2002`) and retry the code rather than pre-checking, record an idempotency key where an outside service will call us.
- **Read, decide and write in one transaction when the decision depends on the read.**
  Two staff members saving at once must not each describe a stale "before".
  When a change has a log entry, the entry and the change commit together and describe the same transition (`changeClinicWithLog()` in `lib/db/clinics.ts` is the pattern; its read takes a row lock inside the transaction, so overlapping saves describe the actual previous values).
  For any write that matters, test a forced overlap, not just the happy path.
- **Every outside service fails sometimes.**
  Clerk, Stripe, Mux, Neon, Vercel, the CDN.
  Before claiming two systems stay in step, write down which one is the source of truth for each fact, what happens if the second write fails after the first succeeded, how a retry is made safe, and how the two are reconciled later.
  "It worked in the test" is not that.
- **Webhooks.**
  Verify the signature against the raw request body, exactly as the sender documents.
  Expect the same event twice and events out of order.
  Do the work, or put it somewhere durable, before answering with success; an acknowledgement sent first and work done second loses the work when the process dies.
  Never log the body, a secret, a share code, a signed URL or a patient-facing link.

### Before you say it is done

- **Check the boundaries, not just the feature:** signed out, a member, an admin, a member of a different clinic, Pulse staff; invalid input; what happens when the request fails; the overlap case where two writes race; and that what already worked still works.
- **Run lint, `tsc`, the tests and a production build** (`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`), and read the output.
  Database tests run only against a positively identified non-production target; the guard in `vitest.setup.ts` refuses anything else and that refusal is never worked around.
  Pure tests should not need a service secret to start.
- **Mocks prove the logic; they do not prove the service.**
  Where behavior depends on Clerk, Stripe, a real browser or a real phone, a mocked test is not the end-to-end check.
  Say which.
- **UI work is looked at in a browser**, on the real page, with the real field.
  Patient and surgeon playback is tried on real phones and tablets, and the report names the device, the browser, the network (cellular, clinic Wi-Fi), whether it was a cold or a warm start, and every failure.
  Claude cannot sign in to Clerk, so the signed-in click-through is a numbered list for Evan, with what he should see at each step.
- **Never call the work complete when a required check was skipped.**
  The report says exactly what was run and observed, what was only simulated, what failed, and what remains for Evan to verify.
  "Should work" is not a result.

---

## The four surfaces

The app is four different screens for four different people.
Keep them separate from the start, because each is gated by a different role and that is much easier if they were never mixed.

| Surface | Who | Device | Access |
|---|---|---|---|
| `app/watch/[code]` | **The patient** | Their own phone | Public, no login, ever |
| `app/library` | **The surgeon**, in the room | Tablet or phone | Clerk sign-in, any member of an open clinic; Send only for someone holding a seat |
| `app/admin` | **The office manager** | Desktop | Clerk sign-in, `org:admin` of the clinic (see Roles). Every page but `/admin/billing` also needs the clinic to be open (see the billing exception below) |
| `app/pulse` | **Pulse 3D staff** (Evan and Van) | Desktop | Clerk sign-in plus `isPulseStaff()`. Anyone else gets not-found. |

**`app/watch` is the patient's page, and it stays about one thing:** one procedure, the clinic's name and logo, calm plain language, large controls, the "for education only" box before the video, and Play.
No account, no consent screen, no cookie banner, no navigation, no related videos, no sales, no tracking.
Its words are fixed and are not changed without asking.
Read `docs/areas/patient-page.md` before touching it (the box and its record, the deadline line, paused links, expiry), and `docs/areas/printed-qr-codes.md` for `app/q`.

**`app/library` is the exam-room surface:** tablet-first, rows of videos, a card opens the video's watch page paused, Play and Send are separate one-tap actions, and it shows only what the clinic's plan allows.
Only someone holding a seat gets Send.
No number about hearts or plays is ever shown on the clinic side, and no price is ever shown in the library.
Read `docs/areas/library.md`.

**`app/admin` is the back-office surface**, and each page has a fixed job: `/admin` (overview), `/admin/links` (making a link, and printed QR codes), `/admin/people`, `/admin/billing`, `/admin/branding`; `/admin/reports` only redirects to `/admin`.
Never move a job to another page or merge two.
**Never put a list of past links back on the clinic side, and never put plan or billing detail anywhere but `/admin/billing`** and the sign-up steps a new clinic's owner goes through before the clinic opens (`/onboarding/plan` and `/onboarding/payment`, never the library).
The one other place is setup's "Add a seat?" confirmation (`/onboarding/setup/team`), which shows the price of one more seat, worked out by Billing's own plan-change code, before it is bought, and only where Billing would offer the change.
Billing stays reachable when the clinic is closed.
Clinics get no reports or usage numbers at all.
Read `docs/areas/admin-area.md`.

**`app/pulse` is the Pulse 3D master dashboard**, for Pulse staff only.
Who may open it is decided in one function, `isPulseStaff()` in `lib/pulse.ts`; every page and every Server Action under `app/pulse` calls `requirePulseStaff()` first, and anyone else gets not-found.
Nothing on it is visible to clinics, and it never shares a page with `app/admin`.
Read `docs/areas/pulse-dashboard-and-reports.md`.

---

## Stack

| Layer | What we use | Notes |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript + Tailwind** | Server Components by default. Add `"use client"` only when a component genuinely needs browser interactivity. |
| Hosting | **Vercel** | |
| Database | **Neon** (PostgreSQL) | |
| Data access | **Prisma 6**, behind `lib/db` | Server only (rule 1). Production is migrated with `prisma migrate deploy` and nothing else (rule 3). |
| Video | **Mux signed playback**, and the Webflow CDN for a video that still has an address there | Only `lib/playback-auth.ts` builds an address a player loads. See `docs/areas/video-and-mux.md`. |
| Logins | **Clerk** (`@clerk/nextjs`) | Staff only. See `docs/areas/auth-and-roles.md`. |
| Tests | **Vitest**, against a real database | See `docs/areas/tests.md`. |
| Payments | **Stripe**, **test mode only** | Only `lib/stripe.ts` talks to it. See `docs/areas/billing.md`. |
| Email | **Resend**, over plain HTTPS, no package | Only `lib/email.ts` talks to it. |

The same table with every note is in `docs/areas/operations.md`.

## Folder map, short

The full map, file by file, is `docs/areas/folder-map.md`.

```
app/watch, app/q     The patient's pages: a link, and a printed QR code. Public. Routes, never Server Actions.
app/library          The surgeon's exam-room browser and its watch page.
app/admin            The clinic's back office; app/admin/billing is reachable when the clinic is closed.
app/pulse            The Pulse 3D master dashboard. Pulse staff only.
app/api/webhooks     Stripe, Mux and Clerk notifications. Public; the signature is the check.
lib/db/              EVERY database query. Nothing else touches Prisma.
lib/                 The rules, mostly pure. One file per outside service: stripe.ts, mux.ts, email.ts, people.ts (Clerk).
lib/seat-changes.ts  The only way anyone's seat, role, invitation or ownership changes.
lib/playback-auth.ts The only place a playback address is built.
components/ui/       Shared pieces: the app shell, both players, the error pages.
prisma/              Schema, migrations, and the operator scripts (each refuses production unless told).
docs/areas/          The detail for each area. Read the right one before editing.
docs/decisions.md    Dated decisions: who decided what, and when.
.github/             The automatic checks on every pull request.
.claude/skills/      Two process skills Claude loads here. Never put .ts files under .claude/.
```

---

## Design

Match the live Pulse 3D site.
Do not invent a new palette.

- Fonts on the staff screens (`/admin`, `/library`, `/pulse`, the landing page at `/`, sign-in, sign-up and onboarding): **Schibsted Grotesk** for headings and **Hanken Grotesk** for text (Evan, 2026-11-18), loaded with `next/font/google` in `app/staff-fonts.ts`, which only the staff layouts and the landing page import, and never preloaded (the production build shares its CSS across every page, so a preload would reach the patient's phone too).
  A clinic may choose one of the approved fonts (listed under "Clinic branding and dependable playback") for its own surfaces, and then that font is used for headings and text alike.
  The patient's pages (`app/watch`, `app/q`) and the calm error and not-found pages keep **Inter**, so a patient's phone never downloads the staff fonts.
- Accent: `#2a829b` · Accent deep: `#1e5668` · Accent bright (on dark): `#5fb8d4`
- Light band: `#e4ebf3` · Black: `#000000`
- **The staff screens are light by default** (Evan, 2026-11-18): a clinic that never chose gets light, and a clinic that chooses Dark on its Branding page gets dark.
  **`/pulse` is always dark**, and says so itself rather than relying on any default.
- **The console layout** (the approved design of 2026-11-18): `/admin` and `/pulse` share one frame, `ConsoleShell` in `components/ui`, with a left rail of sections, Library and the signed-in person at the bottom of the rail, and on a phone a top bar with the library and the avatar over a row of section pills.
- **Dark staff screens (a clinic's choice, and all of `/pulse`):** page `#000000` · cards `#0d1113` · rail and text boxes `#07090b` · menus `#0a0d0f` · headings `#ffffff` · body text `#bfbfbf` · muted `#667085` · hairlines white at 10%, button and text-box edges white at 15% · amber `#f3b94d`
- **Light staff screens (the default, and the landing page, sign-in, sign-up and onboarding):** pure white with cool, neutral greys, no warm tint (Van asked for white, not beige, on 2026-09-21) · page, cards, menus and text boxes `#ffffff` · rail `#f3f5f7` · headings `#12202a` · body text `#3a4c56` · muted `#52616a` · hairlines `#e3e7eb`, button and text-box edges `#737b83` · amber text `#684400` · Pulse accent `#1e5668`, which is also the link shade
- **The patient page (always light, whatever the clinic chose), its calm error and not-found pages, and the Branding form's preview of it:** plain white too (Van, 2026-10-05) · page `#ffffff` · headings `#12202a` · body text `#3a4c56` · small text `#46555e` · hairlines `#e3e7eb` · the soft circle behind an icon `#eef1f4` with the icon `#52616a` · the clinic's colour only as the thin top band and the call button, adjusted against white (`PATIENT_GROUND` in `lib/branding.ts`) · the placeholder bar stays amber
- In code these are never written as hex: use the token classes (see "Light and dark staff screens").
  The values live in `app/globals.css`.

**No monospace fonts anywhere in the interface.**

---

## The speed rule

`app/watch` and `app/library` are both governed by one sentence from a surgeon:

> "The second I have a delay, I will just turn it off and I will just bring up my own stuff."

**This is a performance specification, not a preference.**
It applies to both in-room surfaces and outranks any feature that would slow them down.
If a change would delay the first frame or add a step, flag it before building.

### `app/watch`, the patient viewer

- **Almost no friction.**
  No account, no login, no password, no app to install, no cookie banner, no email capture.
  One box to tick before the video (decided by Evan and Van on 2026-10-08), on the page itself, never a screen of its own.
  Scan, tick, watch, done.
- **The video starts in under two seconds from the Play tap.**
  The tick asks the server for the video (one short request), and the player starts loading it at once, while the patient's thumb moves from the box to Play; keep that request to the fewest reads possible.
- **Phone-first.**
  Assume a 65-year-old on cellular data in a waiting room, holding their own phone, possibly anxious.
  Large tap targets, high contrast, no small text.
- **Nothing to click except the box and play.**
  No navigation, no menu, no related videos, no footer links, no sales.
  The exceptions are named, never added quietly: Ask my clinic on a paused link, and "Save or share this link" under the video on a working one (decided by the user on 2026-11-16), which is quiet, below the player, and never starts or stops the video.
- **The expired state is a real design job, not an error page.**
  Calm, plain language, tells them to ask their doctor for a new link.
  Never technical, never red, never the words "error", "invalid" or "403".
  The same goes for a video that will not load: a plain sentence and a way to try again, never the exception.
  **The paused state is the same job with one button:** "This link has paused. Tap below to ask your clinic to turn it back on", then "Your clinic has been asked. Try this same link again in a day or so."
  No box to type into, ever, and no deadline or count on the page.

### `app/library`, the surgeon in the room

- **Three taps from opening it to a playing video.**
  That is the design budget: a category, a card, then Play (two, a card then Play, when the video is in a row on the home page).
  It was two until 2026-10-15, when Evan decided a card opens the video's watch page PAUSED, because a surgeon may open it while still talking to the patient and a video that starts by itself talks over them.
  The Play tap is the only step added; the watch page fetches the video as it opens, so Play starts at once.
- **Tablet-first.**
  Big thumbnails, procedure names large enough to read at arm's length, no dense tables and no tiny controls.
- **Browse by category**, because a surgeon knows the body part before they know the procedure name.
- **Playing and sending are separate actions, both one tap** on the watch page (Play on the video; Send to patient or Show QR on screen under it), and Send is also one tap on every card.
  Sometimes they show it in the room, sometimes they send it home, often both.
- **The home page's rows are light.**
  No hover previews or autoplay on a card; a still is loaded lazily, and a video with no still makes its one-second frame only when its card is near the screen; rows scroll by swipe, with arrows on a computer only.
- Assume it is being used standing up, one-handed, with a patient watching.
  Nothing that needs careful aim.

---

## Writing copy

Van's voice: plain-spoken, direct, no wind-up.
Peer to peer.
Simplest honest version first, then a concrete example.

- **No em dashes.**
  Use commas, colons or parentheses.
- No marketing language in the product interface.
- Never claim the product guarantees a patient understands anything, and never say it replaces or satisfies informed consent.
  It **supports** the consent conversation.
  This wording matters legally and is not flexible.
- **The "for education only" wording is fixed.**
  On the patient page it is the box before the video: "I understand this video is for education only. It is not medical advice, and I will ask my doctor about anything I am unsure of." (`DISCLAIMER`).
  On the printed pamphlet it is "This video is for education only. It is not medical advice. Ask your doctor about anything you are unsure of." (`EDUCATION_ONLY`).
  Both are in `lib/education-note.ts`, never mention consent, and are not reworded without asking.
  Ticking the box is never called consent, never said to replace or satisfy informed consent, and a count of ticks is never described as proof that anyone understood.
- **A number is labelled by what it measures.**
  A play start is a play start.
  A link that was issued is a link that was issued.
  Neither is a unique patient, a completed watch, proof that someone understood, or evidence of consent, and no screen, report, PR or sales page describes it as any of those.
  A link a printed QR code handed out is not a scan and not a person either: it is one tap on Play, and one patient visiting twice makes two.
- **Technical failures never reach a patient.**
  Exception text, status codes and stack traces go to the server log; the patient sees a calm sentence and a way to try again.
- **Security limits are stated honestly.**
  An expiring link, a signed address and a cancelled link limit who can start a new play.
  They do not stop screenshots, do not stop all copying, and do not take back what a phone has already loaded.
  Never promise more than that to a clinic.

---

## Commits and pull requests

**Commits:** plain English, present tense, one line.
"Add expiry check to watch page."
Not "feat(watch): implement TTL validation middleware."

**One prompt, one pull request** (rule 5), and its description is written for Evan, who cannot read the code.
It says:

- the problem, and the behavior once the change is in;
- every migration and every script that changes rows, with the production order, why the old code keeps working during the minutes in between, and how it would be recovered (rule 3);
- exactly which checks ran and what they showed: lint, `tsc`, the test count and files, the build, the browser check, and any real-device check with the device named;
- a numbered preview walkthrough for the things only a signed-in person can try;
- the risks, and everything that remains unverified or unfinished, in as many words.

**A green summary is evidence, not a review.**
Claude never merges, never migrates production, never runs a production data script, never changes a live vendor setting and never deletes an external asset.
Those wait for Evan's explicit instruction after he has read the PR; reading it is not the instruction.

**When behavior changes, the rules change with it**, in the same pull request: this file for a rule that applies everywhere, the area file in `docs/areas/` for the detail.
An old sentence that no longer holds is removed, not left beside the new one.
The rules documents are written one sentence per line, so that two pull requests editing different sentences of the same paragraph can merge, and new text follows the same form.

---

## Where the detail lives

**Before touching an area, read its file.**
Each holds the detail that used to be in this file.
Code comments and older documents point at sections by their old names ("Billing state", "Auth"); the third column says where each one is now.

| Before touching | Read | Old section names now there |
|---|---|---|
| What is built and what is not | `docs/areas/product-scope.md` | "Phase 1 scope", "Phase 2 scope" |
| `app/watch`, the education box, link expiry, paused links | `docs/areas/patient-page.md` | the `app/watch` paragraph, "What `viewCount` means", "How a link expires, pauses, and is turned back on", "The disclaimer record" |
| `app/q`, printed QR codes | `docs/areas/printed-qr-codes.md` | "Printed QR codes" |
| `app/library`, access to videos, placeholders, settings | `docs/areas/library.md` | the `app/library` paragraph, "Category entitlements", "Nothing breaks while the library fills up", "Placeholder videos" |
| Categories | `docs/areas/categories.md` | "A category's name", "Categories are text", "Adding a category" |
| `app/admin` and its pages | `docs/areas/admin-area.md` | the `/admin` page map, "Billing stays reachable when the clinic is not open" |
| Prices, pricing versions, a clinic's plan | `docs/areas/pricing.md` | "Pricing shape", "Clinic plan", "Pricing versions" |
| `app/admin/billing`, Stripe, checkout, plan changes | `docs/areas/billing.md` | "Billing state", "Who may pay by card", "Self-serve checkout", "Plan changes and billing recovery" |
| Seats and who a link is from | `docs/areas/seats.md` | "Surgeon seats" |
| Sign-in, Clerk, roles, the account owner | `docs/areas/auth-and-roles.md` | "Auth", "Previews and production are kept apart", "Roles" |
| Video playback, Mux, uploads | `docs/areas/video-and-mux.md` | "The video boundary" |
| Branding, the mark on the video, the players, light and dark | `docs/areas/branding-and-players.md` | "The name and logo sync", "Clinic branding and dependable playback", "Light and dark staff screens" |
| `app/pulse`, the reports, the clinic log | `docs/areas/pulse-dashboard-and-reports.md` | the `app/pulse` paragraphs, "The Pulse reports", "The clinic log" |
| Headers, the content policy, link codes, the rate limit | `docs/areas/security-headers.md` | "Security headers and link guessing" |
| Error pages, Clerk's time limit, alerts, the health check | `docs/areas/when-something-breaks.md` | "When something breaks" |
| `prisma/`, migrations, operator scripts | `docs/areas/database-and-migrations.md` | rule 3 in full and its steps, "The database", "Clinic status", "Operator scripts", "Neon needs both URLs" |
| Tests | `docs/areas/tests.md` | "Tests", "The local test database" |
| The stack in full, GitHub's checks | `docs/areas/operations.md` | "Automatic checks" |
| Where a file is | `docs/areas/folder-map.md` | "Folder map" |
| Who decided what, and when | `docs/decisions.md` | |

Still in this file: the hard rules, "Working on a task" ("Starting", "Mutations and outside services", "Before you say it is done"), "The four surfaces", "Stack", "Design", "The speed rule", "Writing copy", "Commits and pull requests".
