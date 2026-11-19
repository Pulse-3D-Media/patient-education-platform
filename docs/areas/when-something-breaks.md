# When something breaks

Moved out of the root `CLAUDE.md` in November 2026, word for word except where the pull request that moved it says otherwise.
A section name in quotes ("Billing state", "Roles") is a heading in one of the files under `docs/areas/`; the index at the end of the root `CLAUDE.md` says which.

## When something breaks

Nobody, patient or staff, ever sees Next.js's own "Application error" page, an exception, a status code or a stack trace.
A handful of files under `app/` see to it, one file at the root tells Pulse, and one route lets a monitor watch.

- **Error pages.**
  Next.js draws the nearest `error.tsx` when a page fails while it is being drawn.
  `app/watch/error.tsx` is the patient's: light, large text, "Something went wrong loading this video. Try again in a moment.", one Try again button, nothing else, and no phone number, because the page that reads the clinic's number is the one that failed and this page fetches nothing on purpose.
  `app/library/error.tsx`, `app/admin/error.tsx` and `app/pulse/error.tsx` are the staff version (`StaffError` in `components/ui`): a plain sentence, Try again, and a way back, in the tokens, so inside the library's shell it takes the clinic's mode.
  `app/error.tsx` is the neutral catch-all for anything with no closer page (a staff layout failing before it drew its shell), `app/global-error.tsx` the last resort when the root layout itself fails (it draws its own `<html>` and brings its own stylesheet), and both use the calm frame the patient page uses (`CalmFrame`, `CalmError`).
  Try again is Next's `retry`: it fetches the page again.
  None of them shows the error, its message or its digest; the one thing read from the error is whether its digest is the sign-in one, below.
  Every page fails on the server first, so the detail is always in the server log.
- **Not-found pages.**
  `app/not-found.tsx` is for an address the app does not have, and for `/pulse` opened by someone who is not staff (the layout's not-found lands there, with no dashboard around it): neutral, calm, nothing to click.
  `app/library/not-found.tsx`, `app/admin/not-found.tsx` and `app/pulse/not-found.tsx` (`StaffNotFound`) answer a not-found a staff page raises (an unknown category, another clinic's link code, an unknown clinic or video id) with one sentence and a way back, inside the shell where there is one, and never a word about what was looked for.
- **The layouts keep their shell.**
  `app/library/layout.tsx` and `app/admin/layout.tsx` read the clinic through `getClinicForShell()` (`lib/clinic.ts`), which answers null instead of failing when sign-in or the database does not answer (Next's own redirect and not-found signals are handed back with `unstable_rethrow`, never swallowed), so the banner and menus are still drawn and the page inside, which asks again and gets the same cached failure at once, shows its error page in the content area.
  A layout that failed would leave no banner and no way back.
- **Clerk has a time limit.**
  Every question the app asks Clerk while drawing a page (`getCurrentClinic()`, `getPulseStaffUser()`, the two lookups on `/onboarding`) goes through `askClerk()` in `lib/clerk-timeout.ts`: it waits `CLERK_TIMEOUT_MS` (5 seconds, through `withTimeout()` in `lib/timeout.ts`) and then throws a `SignInUnavailableError`, and turns a failure from Clerk (the network, a 5xx, a bad key) into the same error.
  Its `digest` is a fixed word, which Next.js hands to the browser in place of the message, and the error pages recognise it (`isSignInUnavailable()`) and say "We could not reach sign-in just now" instead of "Something went wrong".
  React's cache remembers the failure, so a layout and its page wait once, not twice.
  The patient page never asks Clerk, so none of this touches it.
  **Every other Clerk call has the same limit** (Prompt Q, October 2026): every read and write in `lib/people.ts` (the People page, the seat changes, the doctor dropdown and the surgeon check in `lib/senders.ts`, and the office admins a paused link's request emails, which a patient's tap reaches) and both writes in `lib/organization.ts`.
  A caller answers the error in a plain sentence, never a crash.
  For a WRITE a timeout means "we do not know", because Clerk may still make the change after we stopped waiting, so the seat changes say "we cannot be sure that went through, reload the page" (`isClerkTimeout()` in `lib/people.ts`) rather than "nothing was changed", and an invitation whose sending timed out keeps its seat hold: the seat check records it if the invitation went out, and lets the hold go after a few minutes if it did not.
- **Error alerts.**
  `instrumentation.ts` at the root exports `onRequestError`, which Next.js calls for every error the server captures while drawing a page or running a route handler, a Server Action or the proxy (not for a not-found or a redirect).
  It writes one line to the server log, `Request error: {...}`, beside the full error Next.js logs itself.
  When `ERROR_ALERT_EMAIL` is set and email is configured it also sends one email per distinct error every ten minutes through `lib/email.ts`, **up to a ceiling: at most `ALERT_CEILING` (3) in a window for one route, kind and error name, however many different errors that is**, because a digest comes from the error's text and some error text varies with the request.
  Past the ceiling, one note says alerts were held back, and the rest are in the log only (every error is always logged).
  So one group is at most four emails per ten minutes.
  This server remembers what it sent, and each message carries an idempotency key built from the deployment type, the route pattern, the kind, the error name, which of the group's alerts it is (1 to 3) and the window, never the digest: however many servers are running, one group has only those three keys and the note's one, and Resend drops the repeats, so the ceiling holds across all of them and an outage that fails a thousand requests is one email.
  **The trade-off:** two servers each seeing a different first error in the same window use the same key, so one of the two is not emailed (it is in the log).
  Next.js does not always wait for `onRequestError`, and the function may be suspended afterwards, so an alert is claimed before anything is awaited, the send is handed to Next.js's `after()` so the platform keeps the function alive for it, and a claim is never given back when a send fails, or an email outage would become one attempt per error.
  A lost send is lost from that server; the error is still in the log.
  The ceiling is per group, so a failure across many routes can still send several emails per window.
  The record is built in one place, `describeRequestError()` in `lib/error-report.ts`, and carries only: the time, the deployment (`VERCEL_ENV` and the short commit), the route PATTERN as written in the app folder (`/watch/[code]`, never a code), the method, the kind (page, route handler, action, proxy), the error's class name and its digest.
  Never the address opened, a header, a body, the message or the stack, and `lib/error-report.test.ts` proves it.
  No monitoring package is installed (rule 6); if one is chosen later, `onRequestError` is where it plugs in, behind the same scrubbing.
- **The health check.**
  `GET /api/health` runs `pingDatabase()` (`lib/db/health.ts`, one `SELECT 1`) with a five-second limit and answers `200 {"ok":true}` or `503 {"ok":false}`, never cached, with nothing else in the body.
  Public, for an uptime monitor.
  **The answer is remembered for five seconds** (`HEALTH_MEMORY_MS` in `lib/health.ts`, audit finding F3, November 2026), ok or not, and calls that arrive while a query is on its way wait for that one, so a burst of calls from anyone is one query per server; each server remembers for itself.
  A monitor that calls it every few minutes keeps the Neon compute awake, which counts against its compute hours.

## The daily job: setup reminder emails

**What it does.**
Once a day Vercel calls `GET /api/cron/setup-reminders` (the entry in `vercel.json`, 15:00 UTC; on the Hobby plan Vercel fires it at any minute of that hour).
It emails a clinic's account owner, and nobody else, 1 day, 1 week and 2 weeks after the clinic signed up, only while setup is unfinished; the third is the last (Evan, 2026-11-18).
"Signed up" is the clinic row's `createdAt`, which the clinic cannot change.
Only an ACTIVE clinic with setup under way (`setupStep` one of the four steps) and an owner who is still an admin of it is emailed: never a clinic made before setup existed, a finished one, one that never paid (PENDING), a paused, cancelled or past-due one.
A clinic Pulse manages by hand is not left out, because setup and the library's "Finish setup" reminder do not leave it out either.
The rules are `lib/setup-reminders.ts`, the run `lib/setup-reminder-run.ts`, the record `lib/db/setup-reminders.ts`.
**Each run sends at most the one reminder now due to each clinic**: a missed day is made up the next day, never two at once, never an older reminder after a newer one, and nothing from three weeks after sign-up.
A run looks at no more than 25 clinics, oldest sign-up first, and stops starting new ones after 200 seconds; the rest go the next day.

**Safe twice, late or overlapped.**
The reminder is decided and recorded (`Clinic.setupReminder`, `Clinic.setupReminderAt`) in one transaction holding the clinic's row lock, and only then sent, so two runs at once send one email and a rerun sends none.
If the send fails after the record, that reminder is missed rather than sent twice; Resend also gets an idempotency key per clinic and reminder.
If Clerk does not answer, or the owner left, nothing is recorded and the next run looks again.

**The secret.**
The route is public by address, so it refuses everything unless the request carries `Authorization: Bearer <CRON_SECRET>`, which is how Vercel calls it (compared in constant time, `lib/cron-secret.ts`).
With no `CRON_SECRET` on the deployment, or one shorter than 16 characters, it answers 503 "not configured" and sends nothing; a wrong one gets 401.
`CRON_SECRET` is set by Evan in Vercel for Production; a scheduled job runs only on the production deployment, so Preview needs none.
Without `RESEND_API_KEY` and `EMAIL_FROM`, or without a known address for the app (`APP_ORIGINS` or Vercel's own), the run reads and records nothing.
The "Reply to this email and a person will answer" line is in the email only when `EMAIL_REPLY_TO` is set, because `EMAIL_FROM` may be a no-reply address.

**How to tell it ran.**
Vercel, the project, Settings, Cron Jobs, View Logs: each run writes one line, `Setup reminders: run finished` with counts (checked, sent, skipped, failed, more).
The answer and the log hold counts and the kind of a failure only: never an address, a clinic name, an id, the secret or an error message.

**If it did not run, or `failed` is not 0.**
Vercel does not retry a failed call; the next day's run catches up, inside each reminder's window.
"not configured" in the log means `CRON_SECRET` is missing on Production (add it, then redeploy, since a deployment reads it when it is built).
A failed send names one word (refused, unreachable): check Resend's dashboard and the two email settings.
To run it by hand, call the address with the header (`curl -H "Authorization: Bearer <secret>" https://<site>/api/cron/setup-reminders`): it is safe to repeat.
