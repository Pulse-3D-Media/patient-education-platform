# CLAUDE.md

The rules file for the `patient-education-platform` repository, where it lives as `CLAUDE.md` in the root.
Claude reads it automatically at the start of every session, so this is the one place project rules belong.

A copy is kept on the desktop as `3 - Repo rules file.md`. If you edit one, copy it to the other.

---

## What this is

The Pulse 3D Patient Education Platform. Surgical patient education animations, delivered to patients on their own phones.

A clinic creates a share link. The patient scans a QR code or opens the link, watches an animation explaining their upcoming procedure, and the link expires after a set number of days.

**Phase 1 is done:** create a link, watch a video, link expires.
**We are in Phase 2, the clinic dashboard:** logins (done, see Auth), clinics and people (done, see Roles), the Pulse 3D master dashboard (done, see the four surfaces), then billing screens, branding, real video hosting.
**Phase 3 is billing.**

## This repository is public

Deliberate, for now: Vercel's free plan will not deploy a private repository, and we are pre-revenue. It goes private when we move to Vercel Pro, which will be before launch.

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

Why both: in Phase 1 `clinicId` comes from a single constant. In Phase 2 it comes from the signed-in user. **Because the seam already exists, Phase 2 is a swap, not a rewrite** - and there is exactly one place to check that clinics cannot see each other's data.

### 2. No patient-identifying information, anywhere, ever.

No names, no dates of birth, no email addresses, no medical record numbers, no clinical notes. A share link is tied to a **procedure** and a **clinic**, never to a person.

This keeps the platform outside the scope of HIPAA. If a task appears to require storing patient information, **stop and flag it** rather than building it.

### 3. Never change the database schema unless explicitly asked.

`prisma/schema.prisma` is the foundation everything else sits on. If a task seems to need a new column, table or relation, **stop and say so first.** Never rename or delete an existing field.

**Never change the database by hand in the Neon console.** Every change is a Prisma migration, committed to git. Hand edits break migration history in ways that are painful to unwind.

### 4. Do not remove things that look unused.

Several fields exist for later phases and are deliberately unused right now, including `Video.isPublished` (only ever set by the seed scripts so far). **They are load-bearing later. Leave them alone.**

### 5. One task at a time.

Do the thing that was asked, not the three adjacent things that would also be nice. If you spot something else worth doing, say so and wait. Small changes are reviewable by someone who cannot read code; large ones are not.

### 6. Do not add dependencies casually.

Ask first, and say what the package is for in plain English.

### 7. Never commit secrets. THIS REPOSITORY IS PUBLIC.

Everything sensitive lives in `.env`, which stays out of git. `.gitignore` must always cover `.env*`.

**The repository is public while we are pre-launch.** That raises the stakes on this rule considerably:

- A committed database URL or API key is found by automated scanners **within minutes**, not eventually.
- **Git history is permanent.** Deleting the file in a later commit does not remove the secret from history. Anything committed once must be **rotated**, not just deleted.
- **Never hardcode a connection string, key or token anywhere in the code**, not even temporarily while testing. If a value is needed, it comes from `process.env`.

Before any commit that touches configuration, confirm `.env` is still ignored.

---

## The four surfaces

The app is four different screens for four different people. Keep them separate from the start, because Phase 2 gates them by role and that is much easier if they were never mixed.

| Surface | Who | Device | Access |
|---|---|---|---|
| `app/watch/[code]` | **The patient** | Their own phone | Public, no login, ever |
| `app/library` | **The surgeon**, in the room | Tablet or phone | Clerk sign-in, any member of an open clinic |
| `app/admin` | **The office manager** | Desktop | Clerk sign-in, `org:admin` of an open clinic (see Roles) |
| `app/pulse` | **Pulse 3D staff** (Evan and Van) | Desktop | Clerk sign-in plus `isPulseStaff()`. Anyone else gets not-found. |

**`app/library` is the exam-room surface.** A surgeon opens it mid-consult, finds the procedure, and either plays it right there on their own device or sends the patient a link. It is used standing up, in front of a patient, under time pressure. **It obeys the same speed rule as the patient viewer** (see below): tablet-first, big touch targets, browse to playing in two taps, no dense tables.

**`app/admin` is the back-office surface.** Creating and managing share links, printing pamphlets, checking what got watched. Desktop, sitting down, no hurry.

A member sees the library; an admin sees both. **Do not merge them into one page.**

**`app/pulse` is the Pulse 3D master dashboard.** Used only by Pulse staff, Evan and Van. It shows every clinic, every video, and every price and rule. **Nothing on it is visible to clinics.** It is not a bigger `app/admin`: admin shows one clinic its own data, pulse sees across all of them, so the two never share a page.

**Who may open it is decided in one function, `isPulseStaff()` in `lib/pulse.ts`.** A person is Pulse staff when their Clerk user has `pulseStaff: true` in its public metadata, set by hand in the Clerk dashboard (Users, the user, Metadata, Public) and nowhere else. It is read on the server from Clerk's backend API on every request. **Every page and every Server Action under `app/pulse` calls `requirePulseStaff()` first**, which ends the request with not-found for anyone else: not a redirect, not a message, so the dashboard's existence is not confirmed to people who cannot use it. The `/pulse` layout checks too, so the not-found page has no dashboard rail around it. Never check this in the browser only.

Built so far: the clinics table (`/pulse`), one clinic's page (`/pulse/clinics/[id]`, six sections behind a row of pills: Overview with status by hand and managed-by-Pulse, Plan, Details, People, Links, and Notes, an append-only log to which every change saved on the page adds an entry of its own) and the platform settings (`/pulse/settings`). Videos, Pricing and Reports are placeholder pages.

## Phase 1 scope

**In scope:** the three models below · `app/library` to browse and play · `app/admin` to create and manage share links · `app/watch/[code]` for patients · QR code generation · link expiry.

**Out of scope in Phase 1, and still not built unless a task asks for it:** user accounts of our own, invitations, roles, per-clinic category entitlements, subscriptions, payments, Stripe, analytics dashboards, email sending, video uploading, file storage.

**Do not invent a login system.** Sign-in is **Clerk** (see Auth), and its organizations feature is what models clinics and doctors. Never add a users table, a password field or a session cookie of our own.

If a request seems to need something on the out-of-scope list, say so before building it.

## Phase 2 scope

Phase 2 is the clinic dashboard: logins, clinics, doctors, permissions, real video hosting. It also adds **`app/pulse`**, the Pulse 3D master dashboard (see the four surfaces above).

**Decided: self sign-up with card payment.** Solo (1 surgeon) and Clinic (2 to 10 surgeons) sign themselves up and pay by card. Enterprise (11 or more surgeons, or any hospital) is set up by Pulse from `app/pulse`. The card payment itself is billing work (Phase 3): decided, not yet built.

**Built so far:** a person signs up, creates their clinic (a Clerk organization) at `/onboarding`, answers the surgeon-or-staff question once, and lands on a PENDING clinic that shows "Choose a plan to start" until billing, `npm run db:set-status`, or Pulse staff on `/pulse` makes it ACTIVE. Admins invite people and mark each one Surgeon or Staff in `/admin/people`. Pulse staff set each clinic's plan (categories and surgeon seats) on `/pulse` or with `npm run db:set-plan`; seat limits are not enforced until billing.

### Pricing shape

Pricing is per category, per surgeon seat. Each category has its own monthly price per seat, and a clinic pays the sum of its chosen categories times its number of seats, with optional discounts by how many categories it takes. Office staff are never charged. **The numbers are settings, not code** (see below).

---

## Nothing breaks while the library fills up

Finished animations arrive slowly and placeholders stand in until they do, while clinics use the app the whole time. Every change has to be safe to ship with the library half full.

- **A migration only adds.** Every new column has a default or is optional. Never delete or rename.
- **Anything shown to a person has a fallback for when its data is missing.** No logo: show the clinic name. No poster: the branded fallback. No Mux id: the CDN file.
- **A category with no published video shows "Coming soon" in the library** and is not offered for sale.
- **A placeholder video carries its mark everywhere it appears.** Swapping in the real file is an edit to the same row, never a new row, so share links and QR codes keep working.
- **Settings come from `getSettings()` in `lib/db/settings.ts`, never constants.** Prices, expiry days and limits are one AppSettings row, read at request time. `getSettings()` returns the code defaults when the row does not exist, so nothing depends on it having been saved. A clinic can carry its own override for a setting (`Clinic.viewDaysOverride` today); read the clinic's value first, then the platform's. Never put one of these numbers in a page or a constant. (`lib/expiry.ts` still holds `SHARE_EXPIRY_DAYS` from Phase 1; it moves onto the settings row when the 7-days-from-first-view expiry is built.)
- **Access is decided in one function each.** Whether a clinic may use the app at all: `clinicIsOpen(status)` in `lib/clinic-status.ts` (today: ACTIVE only; a grace period or pausing changes that one function). Whether a person is an admin: `isClinicAdmin()`. Whether a clinic can use a video: `canUseVideo()`. Whether someone can open `/pulse`: `isPulseStaff()`. Pages call these and never re-implement any check.

---

## Stack

| Layer | What we use | Notes |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript + Tailwind** | Server Components by default. Add `"use client"` only when a component genuinely needs browser interactivity. |
| Hosting | **Vercel** | |
| Database | **Neon** (PostgreSQL) | |
| Data access | **Prisma**, behind `lib/db` | Server-side only. See rule 1. |
| Video | **the existing Webflow CDN URL** in Phase 1 | Read it through `getPlaybackUrl()`. See below. |
| Logins | **Clerk** (`@clerk/nextjs`) | Staff only. See Auth below. |
| Tests | **Vitest**, against a Neon branch called `testing` | `npm test`. See Tests below. |
| Payments | **none until Phase 3** | |

### Auth

Clerk guards the staff surfaces. The patient surface is never behind it.

- **`/admin`, `/library`, `/pulse` and `/onboarding`, and everything under them, need a signed-in user.** `/watch`, `/q`, `/api/webhooks`, `/sign-in`, `/sign-up` and static files are always public. The list of guarded prefixes lives in `proxy.ts` (Next.js 16's name for the middleware file).
- **`proxy.ts` is a convenience, not the security boundary.** It sends signed-out visitors to `/sign-in` and back again. Clerk's guidance is that every page, Server Action and Route Handler that reads protected data checks for itself, so: staff pages call `requireClinicPage()` first (which calls `await auth.protect()`); actions and handlers rely on `getCurrentClinicId()` returning null. Keep both layers.
- **A clinic is a Clerk organization, and the Clinic row is created on first use.** `getCurrentClinic()` in `lib/clinic.ts` reads the signed-in user's membership in their active organization from Clerk (one call per request, cached), then upserts the Clinic row keyed on `clerkOrgId` (`upsertClinicForClerkOrg()` in `lib/db/clinics.ts`): the first visit creates it with status PENDING, later visits copy a changed name or logo. No webhooks. It is the only place the signed-in user meets the database. **A Clerk organization id (`org_...`) is not a clinic id** and must never be passed to a `lib/db` function that takes a `clinicId`.
- **`requireClinicPage()` is what every staff page calls first.** Signed out goes to `/sign-in`; no organization goes to `/onboarding` (Clerk's CreateOrganization form, or the list of organizations they were invited to); surgeon question unanswered goes to `/onboarding/kind`. It returns the clinic (id, name, status, logoUrl, kind, isAdmin). Each page then checks `clinicIsOpen(clinic.status)` and shows `<ClinicClosed />` if not; admin pages also check `clinic.isAdmin` and show `<AdminsOnly />` if not. Never crash, never a blank page.
- **`getCurrentClinicId()` is for Server Actions and Route Handlers.** A database lookup, no call to Clerk. It returns the clinic id only when the clinic is open, otherwise null, and actions return a plain message on null.
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

---

## The database

Five models and three enums. If a task seems to need a sixth model, stop and ask.

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
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  shares          Share[]

  @@index([category])
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

**Clinic status.** A clinic is created PENDING and only ACTIVE clinics get in. Until billing exists, Pulse staff switch a clinic on from its page on `/pulse`, or with `npm run db:set-status -- <clinicId> ACTIVE`. Never change a status by hand in Neon.

**The clinic log.** `ClinicNote` is the history of a clinic as Pulse sees it: notes staff type (kind STAFF), and entries the app writes when something changes (kind STATUS, named for the first such change and shown as "Change"). **Every change staff save on a clinic's page writes an entry: status, plan, managed by Pulse, and each detail field**, saying what it was and what it became, under the staff member's name. The change and its entry go in one transaction (`changeClinicWithLog()` in `lib/db/clinics.ts`), so the current state and the history cannot disagree, and a save that changes nothing writes nothing. Entries are only ever added. When billing changes a status later, it writes the same pair under its own name. If you add a new thing staff can change about a clinic, write it through the same helper so it is logged too. Nothing in the log is ever shown to the clinic.

**Clinic plan.** `Clinic.categories` and `Clinic.surgeonSeats` are the plan. Set on `/pulse` or with `npm run db:set-plan -- <clinicId> --categories all --seats 10`. Nothing enforces them yet; that comes with billing and category entitlements.

**The name and logo sync.** On every sign-in `upsertClinicForClerkOrg()` copies the organization's name from Clerk, and its logo when Clerk has one. A logo set by Pulse staff survives when the organization has no logo of its own. A name changed on `/pulse` is written to the Clerk organization as well (`lib/organization.ts`), so it does not change back.

**Neon needs both URLs.** `DATABASE_URL` is the pooled connection the app uses; `DIRECT_URL` is the unpooled one Prisma needs to run migrations. Leaving `directUrl` out causes migrations to fail in ways that are hard to read.

**Placeholder videos.** A video with `isPlaceholder` true carries a real procedure name but plays a sample animation, so the library can be tested before the finished animations exist. This is not the same as unpublished: placeholders are visible on purpose. The app marks them everywhere they appear (an amber "Placeholder" mark on the library card, in the player, across the top of the patient page, and in the admin lists). **If you show a video somewhere new, carry the mark with it.** They are seeded by `prisma/seed-placeholders.ts`; the real animations live in `prisma/seed-video.ts`, which never touches them.

---

## Folder map

```
app/watch/[code]     The patient viewer. Phone-first, no login, no navigation.
app/library          The surgeon's exam-room browser. Tablet-first. Browse, play, send.
app/admin            The office-manager console. Share links, QR codes, reporting.
app/admin/print/     The printable pamphlet for one share link.
app/admin/qr/        The QR code image for one share link.
app/admin/people/    The People section: everyone in the clinic, Surgeon / Staff on each, Clerk's invite and role panel. Admins only.
app/onboarding       Set up your clinic (Clerk's CreateOrganization), then the surgeon-or-staff question at /onboarding/kind.
app/pulse            The Pulse 3D master dashboard. Pulse staff only. The clinics table at /pulse; actions.ts holds every Server Action; ui.tsx the shared pieces.
app/pulse/clinics/   One clinic behind a row of pills (ClinicTabs.tsx): overview, plan, details, people, links, notes. forms.tsx holds the client forms.
app/pulse/settings/  The AppSettings form.
app/pulse/videos, pricing, reports   Placeholder pages until each section is built.
app/sign-in          The staff sign-in page, Clerk's prebuilt <SignIn /> component.
app/sign-up          The staff sign-up page, Clerk's prebuilt <SignUp /> component. A new account is sent on to /onboarding.
proxy.ts             Clerk's middleware. Sends signed-out visitors of /admin, /library, /pulse and /onboarding to /sign-in.
lib/db/              EVERY database query. Nothing else touches Prisma. clinics.ts holds the organization-to-clinic lookup, the first-use upsert, and the Pulse-side reads and writes. settings.ts holds getSettings() and saveSettings(). notes.ts holds the clinic log.
lib/pulse.ts         isPulseStaff() and requirePulseStaff(). The one gate for /pulse.
lib/phone.ts         US phone numbers: normalizeUsPhone() to ten digits for storing, formatUsPhone() for showing.
lib/organization.ts  renameClerkOrganization(). Writes a clinic's new name back to its Clerk organization.
lib/video.ts         getPlaybackUrl(). The only place a video URL is built.
lib/clinic.ts        getCurrentClinic() (creates the clinic on first use, syncs name and logo), getCurrentClinicId() for actions, requireClinicPage() for pages. The one place the signed-in user meets the database.
lib/clinic-status.ts clinicIsOpen(status). The one place that decides whether a clinic may use the app.
lib/roles.ts         The two Clerk roles, kind, isClinicAdmin(). See Roles.
lib/people.ts        The people in a clinic, from Clerk: listPeople(), setPersonKind(). Never touches lib/db.
lib/share-link.ts    watchLink() and qrFileName(). The only place a patient link is built.
lib/base-url.ts      getBaseUrl(). The site's own address, read from the request, so links work on any deployment.
lib/qr.ts            QR codes for share links, as PNG (download) or SVG (print).
lib/brand.ts         The logo address.
lib/format.ts        formatDuration(), seconds as "4:12" for the staff screens. describeDuration(), "About 2 minutes" for the patient page.
lib/expiry.ts        SHARE_EXPIRY_DAYS. How long every share link works. The only place that number lives.
prisma/              Schema, migrations, and the scripts: seed, seed-video, seed-placeholders, link-clinic, set-status, set-plan.
components/ui/       Shared buttons, cards, layout. AppShell is the banner and rail around the library and admin (its admin icon shows only for admins). PulseShell is the same for /pulse. StaffClerkProvider, ClinicClosed (clinic not open) and AdminsOnly (a member on an admin page) are the auth pieces. styles.ts holds the shared button and form-field looks.
vitest.setup.ts      Points the tests at the testing database and refuses to run against production.
.claude/skills/      Two process skills Claude loads here automatically: verification-before-completion, systematic-debugging. See its README. Never put .ts files under .claude/.
```

---

## Tests

`npm test` runs Vitest. Tests live next to the code they cover (`lib/db/clinics.test.ts` covers `lib/db/clinics.ts`; `app/pulse/actions.test.ts` covers the dashboard's actions; pure rules such as `lib/clinic-status.ts` get a plain test with no database) and hit a real database: the Neon branch called `testing`, whose pooled connection string is `TEST_DATABASE_URL` in `.env.test` (gitignored, like `.env`). `vitest.setup.ts` points Prisma at it and **refuses to run if that host matches `DATABASE_URL` or `DIRECT_URL`**, so a test run can never touch production.

- Tests must pass before any pull request that touches `lib/db`.
- Tests create their own rows and delete them by id afterwards. They never touch rows they did not make.
- Tests in `lib/db` never need Clerk. A gate or an action that reads the signed-in user (`lib/pulse.test.ts`, `app/pulse/actions.test.ts`) replaces Clerk with `vi.mock("@clerk/nextjs/server")` and plays a staff member or an ordinary user. Everything else that needs a signed-in user is tested by clicking through the preview.
- After any schema migration, the `testing` branch needs **Reset from parent** in Neon before the tests will run against the new schema.
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

- **Zero friction.** No account, no login, no password, no app to install, no cookie banner, no email capture. Scan, watch, done.
- **The video starts in under two seconds.**
- **Phone-first.** Assume a 65-year-old on cellular data in a waiting room, holding their own phone, possibly anxious. Large tap targets, high contrast, no small text.
- **Nothing to click except play.** No navigation, no menu, no related videos, no footer links.
- **The expired state is a real design job, not an error page.** Calm, plain language, tells them to ask their doctor for a new link. Never technical, never red, never the words "error", "invalid" or "403".

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

---

## Commits

Plain English, present tense, one line. "Add expiry check to watch page." Not "feat(watch): implement TTL validation middleware."
