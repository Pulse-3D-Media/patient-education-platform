# CLAUDE.md

The rules file for the `patient-education-platform` repository, where it lives as `CLAUDE.md` in the root.
Claude reads it automatically at the start of every session, so this is the one place project rules belong.

A copy is kept on the desktop as `3 - Repo rules file.md`. If you edit one, copy it to the other.

---

## What this is

The Pulse 3D Patient Education Platform. Surgical patient education animations, delivered to patients on their own phones.

A clinic creates a share link. The patient scans a QR code or opens the link, watches an animation explaining their upcoming procedure, and the link expires after a set number of days.

**We are in Phase 1:** create a link, watch a video, link expires. That is the whole of Phase 1.
**Phase 2 is the clinic dashboard:** logins, clinics, doctors, permissions, real video hosting.
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

Several fields exist for Phase 2 and are deliberately unused right now, including `Clinic.clerkOrgId` and `Video.isPublished`. **They are load-bearing later. Leave them alone.**

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

## The three surfaces

The app is three different screens for three different people. Keep them separate from the start, because Phase 2 gates them by role and that is much easier if they were never mixed.

| Surface | Who | Device | Phase 1 |
|---|---|---|---|
| `app/watch/[code]` | **The patient** | Their own phone | Public, no login, ever |
| `app/library` | **The surgeon**, in the room | Tablet or phone | Open, one user |
| `app/admin` | **The office manager** | Desktop | Open, one user |

**`app/library` is the exam-room surface.** A surgeon opens it mid-consult, finds the procedure, and either plays it right there on their own device or sends the patient a link. It is used standing up, in front of a patient, under time pressure. **It obeys the same speed rule as the patient viewer** (see below): tablet-first, big touch targets, browse to playing in two taps, no dense tables.

**`app/admin` is the back-office surface.** Creating and managing share links, printing pamphlets, checking what got watched. Desktop, sitting down, no hurry.

In Phase 1 both are unguarded and one person uses both. In Phase 2 a surgeon sees the library and an office manager sees both. **Do not merge them into one page.**

## Phase 1 scope

**In scope:** the three models below · `app/library` to browse and play · `app/admin` to create and manage share links · `app/watch/[code]` for patients · QR code generation · link expiry.

**Out of scope, do not build:** logins, authentication of any kind, user accounts, invitations, roles, per-clinic category entitlements, subscriptions, payments, Stripe, analytics dashboards, email sending, video uploading, file storage.

**Do not invent a login system.** Phase 2 uses **Clerk**, and its organisations feature is what models clinics and doctors. Anything built now would have to be torn out.

If a request seems to need something on the out-of-scope list, say so before building it.

---

## Stack

| Layer | What we use | Notes |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript + Tailwind** | Server Components by default. Add `"use client"` only when a component genuinely needs browser interactivity. |
| Hosting | **Vercel** | |
| Database | **Neon** (PostgreSQL) | |
| Data access | **Prisma**, behind `lib/db` | Server-side only. See rule 1. |
| Video | **the existing Webflow CDN URL** in Phase 1 | Read it through `getPlaybackUrl()`. See below. |
| Logins | **none in Phase 1.** Clerk in Phase 2. | |
| Payments | **none until Phase 3** | |

### The video boundary

Never read `video.videoUrl` directly in a page. Always go through:

```ts
// lib/video.ts
export function getPlaybackUrl(video: Video): string
```

Phase 1 returns the stored URL. Phase 2 returns a signed, expiring URL from Mux or Cloudflare Stream. **One function changes and no page changes.**

---

## The database

Three models. If a task seems to need a fourth, stop and ask.

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
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  shares          Share[]

  @@index([category])
}

/// A customer practice. Phase 1 has exactly ONE row, our own test clinic.
/// This table exists now so that Phase 2 does not need a migration on live data.
model Clinic {
  id         String   @id @default(cuid())
  name       String                             // used for the on-video watermark
  clerkOrgId String?  @unique                   // filled in Phase 2. Leave it alone until then.
  createdAt  DateTime @default(now())
  shares     Share[]
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

**Why `Clinic` exists in Phase 1 when there is only one of them.** Adding a tenant column to a table that already holds real customer data is a migration plus a hunt through every query for the ones that forgot to filter. Adding it now costs one table and one column. This is the single most important scale decision in the project.

**Neon needs both URLs.** `DATABASE_URL` is the pooled connection the app uses; `DIRECT_URL` is the unpooled one Prisma needs to run migrations. Leaving `directUrl` out causes migrations to fail in ways that are hard to read.

---

## Folder map

```
app/watch/[code]     The patient viewer. Phone-first, no login, no navigation.
app/library          The surgeon's exam-room browser. Tablet-first. Browse, play, send.
app/admin            The office-manager console. Share links, QR codes, reporting.
app/admin/print/     The printable pamphlet for one share link.
app/admin/qr/        The QR code image for one share link.
lib/db/              EVERY database query. Nothing else touches Prisma.
lib/video.ts         getPlaybackUrl(). The only place a video URL is built.
lib/clinic.ts        getCurrentClinicId(). Phase 1 reads CLINIC_ID, Phase 2 reads the signed-in user. The one swap point.
lib/share-link.ts    watchLink() and qrFileName(). The only place a patient link is built.
lib/base-url.ts      getBaseUrl(). The site's own address, read from the request, so links work on any deployment.
lib/qr.ts            QR codes for share links, as PNG (download) or SVG (print).
lib/brand.ts         The logo address.
lib/format.ts        formatDuration(). Seconds as "4:12".
prisma/              Schema and migrations.
components/ui/       Shared buttons, cards, layout. AppShell is the banner and rail around the library and admin.
```

---

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
