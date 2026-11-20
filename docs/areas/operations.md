# Operations: the stack in detail and the automatic checks

Moved out of the root `CLAUDE.md` in November 2026, word for word except where the pull request that moved it says otherwise.
A section name in quotes ("Billing state", "Roles") is a heading in one of the files under `docs/areas/`; the index at the end of the root `CLAUDE.md` says which.

## Stack, in full

| Layer | What we use | Notes |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript + Tailwind** | Server Components by default. Add `"use client"` only when a component genuinely needs browser interactivity. |
| Hosting | **Vercel** | |
| Database | **Neon** (PostgreSQL) | |
| Data access | **Prisma 6**, behind `lib/db` | Server-side only, and the build enforces it: `lib/db/client.ts` starts with the `server-only` guard (rule 8). See rule 1. Production is migrated with `prisma migrate deploy` and nothing else (rule 3). |
| Video | **Mux signed playback** (files uploaded from `/pulse/videos` straight to Mux), and **the Webflow CDN URL** for a video that still has one | Only `lib/playback-auth.ts` (server only) builds an address a player loads; only `lib/mux.ts` holds the signing key and talks to Mux's API (no Mux package). The player streams with the browser's own HLS or **hls.js**, loaded on demand. See "The video boundary". |
| Logins | **Clerk** (`@clerk/nextjs`) | Staff only. See Auth below. |
| Tests | **Vitest**, against a local PostgreSQL copy or a Neon branch called `testing` | `npm test`. See Tests below. |
| Payments | **Stripe** (the `stripe` package), **test mode only** | Only `lib/stripe.ts` talks to it from the server, and it refuses any key that is not a test key. Card details are entered on Stripe's own page, or (the sign-up payment step only) in Stripe's own card form drawn inside our page by Stripe's script from js.stripe.com, with a `pk_test_` publishable key only; either way they go straight to Stripe, never here. See "Billing state", "Self-serve checkout" and "Sign-up's plan and payment steps". |
| Email | **Resend**, over plain HTTPS, no package | Only `lib/email.ts` talks to it, with the fetch built into Node. Without `RESEND_API_KEY` and `EMAIL_FROM` nothing is sent and the app runs as before. Three emails exist: a patient asking for a paused link back (see "How a link expires, pauses, and is turned back on"), the error alert to Pulse (see "When something breaks"), and the setup reminder to a new clinic's owner (see "The daily job: setup reminder emails"). |
| Scheduled jobs | **Vercel cron**, listed in `vercel.json` | One job, `/api/cron/setup-reminders`, once a day. Runs only on the production deployment, and only once Evan has set `CRON_SECRET` there. See "The daily job: setup reminder emails" in `docs/areas/when-something-breaks.md`. |

## Automatic checks

GitHub runs three checks on every pull request to `main`, from `.github/workflows/`.
None uses a secret, and none can reach any of our databases.

- **"Lint, types and build"** (`checks.yml`): `npm ci`, `npx prisma generate`, `npx next typegen`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
  The build needs no environment values at all.
  If a later change makes it need one, give the workflow a clearly fake value, never a real key (rule 7).
- **"Production migration"** (`migration-check.yml`, with the rule in `.github/scripts/check-migrations.sh`): if the pull request adds, changes or deletes anything under `prisma/migrations/`, it fails until the pull request has the label `production-migrated`.
  Evan adds that label after migrating production (rule 3, step 4); adding or removing a label runs the check again.
  A pull request with no migration passes on its own.
  **The label is a person's word, not proof**: GitHub cannot see the production database and must never be given its connection string.
  A change to `schema.prisma` with no migration file does not trip this check.
  - **The rule that runs is `main`'s copy of the script**, never the pull request's (the check fetches the commit on `main` the pull request is compared with into a folder of its own and runs the script from there), so a pull request that edits the script is still judged by the rule as it is on `main`, and a change to the script takes effect only once it is merged.
    **What it does not cover:** on a pull request GitHub runs the pull request's own copy of the workflow file, so a pull request that edits `migration-check.yml` can change what runs; any change under `.github/` is plain to see in the pull request, and that is where it is caught.
    The trigger stays `pull_request` (never `pull_request_target`, which would run `main`'s workflow but hand the pull request's run a token that can write).
  - **A later push that changes the migrations takes the label off.**
    On every push to a pull request, a read-only job compares the pull request's migration files before the push with after it; a push that only rebases onto a newer `main`, or changes other files, leaves the label alone.
    When they differ, or the comparison cannot be made (a force push can lose the old commit), a second job, the only one in the file that may change the pull request and which does nothing but take that one label off, removes `production-migrated`, and the check, which waits for it and reads the labels as they are now (not as they were when the run started), fails until Evan migrates again and puts the label back.
    If that job cannot finish, the check fails rather than passing.
    Runs are never cancelled by a newer one, and the label job of one pull request runs one at a time, so a label change straight after a push waits for the push's run to take the label off.
    (GitHub keeps only one job waiting in that line, so three events within a few seconds could still slip one past; the push's own run then shows the check failed.)
  - **Dependabot** (`.github/dependabot.yml`) opens at most one grouped pull request a month that brings the actions these workflows use up to date, still pinned to exact commits.
    GitHub Actions only: no routine npm updates (rule 6).
    Dependabot's security alerts and security updates are a repository setting Evan turns on in GitHub himself.
- **"Tests"** (`checks.yml`, added in November 2026): the full test suite, `npm test`, against a throwaway PostgreSQL 18 (the version Neon runs) that GitHub starts inside its own machine for that one run and deletes afterwards.
  The job starts it empty with a made-up password, sets it to UTC as the local test database is, builds its tables with `npx prisma migrate deploy` (pointed at that database for that one step), and runs the tests.
  No Neon, no secret, no outside service.
  Since the database starts empty every time, the tests must make their own rows (see Tests).
  **The guard is unchanged, and on GitHub it proves nothing:** it refuses to run without a production address to compare with, and there is none on GitHub, so the workflow gives it an address that cannot exist (`production-database.invalid`; `.invalid` is reserved so it never resolves).
  Compared with that, the guard passes without checking anything.
  What keeps production safe there is that the test address is written in the workflow file and points at GitHub's own machine, and that machine holds no production address or password at all.
  That fake address is for GitHub only; never put it in a real computer's `.env`, where the guard must compare with the real one.
  A pull request that edits `checks.yml` can change what this check runs, as with the other two; any change under `.github/` is plain to see in the pull request.
- **Whether a check is required before merging** is set by Evan in the GitHub ruleset on `main`, not in code.
  Claude never changes the ruleset.
