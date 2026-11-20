# Sign-in (Clerk) and roles

Moved out of the root `CLAUDE.md` in November 2026, word for word except where the pull request that moved it says otherwise.
A section name in quotes ("Billing state", "Roles") is a heading in one of the files under `docs/areas/`; the index at the end of the root `CLAUDE.md` says which.

## Auth

Clerk guards the staff surfaces.
The patient surface is never behind it.

- **`/admin`, `/library`, `/pulse` and `/onboarding`, and everything under them, need a signed-in user.**
  `/watch`, `/q`, `/api/webhooks`, `/api/health`, `/api/cron` (the daily jobs, which check `CRON_SECRET` themselves), the bare address `/` (the landing page), `/sign-in`, `/sign-up` and static files are always public.
  The list of guarded prefixes lives in `proxy.ts` (Next.js 16's name for the middleware file).
- **`proxy.ts` is a convenience, not the security boundary.**
  It sends signed-out visitors to `/sign-in` and back again.
  Clerk's guidance is that every page, Server Action and Route Handler that reads protected data checks for itself, so: staff pages call `requireClinicPage()` first (which calls `await auth.protect()`); actions and handlers rely on `getCurrentClinicId()` returning null.
  Keep both layers.
- **A clinic is a Clerk organization, and the Clinic row is created on first use.**
  `getCurrentClinic()` in `lib/clinic.ts` reads the signed-in user's membership in their active organization from Clerk (one call per request, cached), then upserts the Clinic row keyed on `clerkOrgId` (`upsertClinicForClerkOrg()` in `lib/db/clinics.ts`): the first visit creates it with status PENDING and records the organization's creator (Clerk's `createdBy`) as the account owner, later visits copy a changed name or logo (the name cleaned by the rename rule, the change logged; see "The name and logo sync") and never touch the owner.
  No webhook makes or updates the row (the Clerk webhook, under "Roles", only runs the seat check and watches the owner).
  It is the only place the signed-in user meets the database.
  **A Clerk organization id (`org_...`) is not a clinic id** and must never be passed to a `lib/db` function that takes a `clinicId`.
- **`requireClinicPage()` is what every staff page calls first.**
  Signed out goes to `/sign-in`; no organization goes to `/onboarding` (Clerk's CreateOrganization form, or, for someone with an invitation or a clinic already, only Clerk's list of those: its own "Create organization" button is hidden through Clerk's styling hook for it, `appearance.elements.organizationListCreateOrganizationActionButton`, because `OrganizationList` has no setting to turn it off, and creating a new clinic is one quiet link under the list, `/onboarding?create=1`; decided by the user on 2026-11-16, audit C4, after an invited person could make a second, empty clinic by accident).
  A new clinic's creator is sent from there to the sign-up plan step, `/onboarding/plan`, which sends them on to `/admin/billing` wherever checkout is not open (see "Sign-up's plan and payment steps" in `docs/areas/billing.md`); someone who joined by invitation goes to the join screen, `/onboarding/join`, which asks a newly invited person for their own name and credential and sends everyone else on to `/library` (see "Surgeon seats"). (`/onboarding/kind`, the retired surgeon question, only redirects to `/onboarding`.)
  It returns the clinic (id, name, status, logoUrl, isOwner, isAdmin).
  Each page then checks `clinicIsOpen(clinic.status)` and shows `<ClinicClosed />` if not (with `billingLink` for an admin, on the library as on the admin pages, so an admin is always one tap from Billing); admin pages also check `clinic.isAdmin` and show `<AdminsOnly />` if not.
  Never crash, never a blank page.
  **The exception is `/admin/billing`**: an admin of a closed clinic must reach it, so it checks `isAdmin` but not `clinicIsOpen` (see the four surfaces).
- **`getCurrentClinicId()` is for Server Actions and Route Handlers.**
  A database lookup, no call to Clerk.
  It returns the clinic id only when the clinic is open, otherwise null, and actions return a plain message on null.
  A billing action has to work for a closed clinic, so it has its own lookup, `getBillingClinicId()`, which checks the admin role and skips the open check; only the actions under `app/admin/billing` may use it, and it must never be used to loosen anything else.
  The one other action that works while closed is Remove on `/admin/people`, through `getClinicIdForRemoval()` (the same check, named for that one action, added in November 2026): removing someone only takes access away, and without it an admin who left a paused or unpaid clinic would keep Billing access with nobody able to take it away.
  Every other People action still needs an open clinic.
  The actions that change a paying clinic's billing (changing the plan, cancelling a change, Stripe's billing page, paying a missed invoice) use it too: any office admin, open or not.
- **`/api/webhooks/stripe` has no sign-in at all, on purpose.**
  Stripe's signature over the exact bytes it sent stands in for one (`verifyWebhook()` in `lib/stripe.ts`), and nothing is read, stored or done before it has been checked.
- **`npm run db:link-clinic -- <clinicId> <orgId>`** still exists for a clinic created before its organization (the test clinic was).
  Clinics that sign themselves up never need it.
  It refuses a clinic that is already linked to a different organization (re-pointing hands the clinic to whoever signs in with the other one) unless `--relink` is added, and the link goes in the clinic log, under "npm run db:link-clinic", through `linkClinicToClerkOrg()` and `changeClinicWithLog()`.
- **`CLINIC_ID` is retired.**
  Nothing reads it.
  Remove it from `.env` and from Vercel.
- **Clerk's provider wraps only the staff side** (`StaffClerkProvider` in the layouts of `app/library`, `app/admin` and `app/onboarding`, and, through `LandingProviders` in `components/landing/LandingFrame.tsx`, the landing page at `/`, `app/sign-in` and `app/sign-up`).
  Never put it in the root layout: that would load Clerk's script on every patient's phone.
  `auth()` on the server works without it.
- The sign-in and sign-up paths, `/sign-in` and `/sign-up`, are set in code in three places that must agree: `proxy.ts`, `StaffClerkProvider` and the `<SignIn path>` / `<SignUp path>` props (and `/sign-up/sso-callback`, where `SetUpClinicForm` sends Google back to).
  No `NEXT_PUBLIC_CLERK_*_URL` variables are used.
  **Clerk may only send someone on to this deployment's own addresses** after signing in or up (`allowedRedirectOrigins` in `StaffClerkProvider`, from `clerkRedirectOrigins()` in `lib/trusted-origin.ts`: the addresses Vercel and `APP_ORIGINS` name, never the request, wildcards left out, localhost when nothing is known; Clerk always allows the page's own address too, so a preview returns to itself).
  Left unset, Clerk would also allow every address under our Clerk instance's root domain, the marketing site included.
  After signing up or in with no page asked for, `StaffClerkProvider` sends people to `/onboarding` (`signUpFallbackRedirectUrl`, `signInFallbackRedirectUrl`), which routes them: the creator of an unpaid clinic to the plan step (or Billing where checkout is not open), the owner of an open clinic to the library, everyone else to the join screen (which forwards anyone with nothing to enter to the library).
  An invitation accepted through Clerk's sign-up form goes to the join screen directly (`forceRedirectUrl` on that form).
  The root address `/` sends a signed-in person to `/onboarding` too (never straight to the library), so someone who signed up from there is routed the same way.
  A signed-out visitor at `/` gets the landing page instead (see "The landing page and sign-up" below).
  Anyone who still lands on the library's closed-clinic page gets a Go to billing button if they are an admin (a member is told to ask one).
  Invitations sent from `/admin/people` carry this deployment's `/sign-up` as their return address (from `pickTrustedOrigin()`, never the browser), so the email's link comes back to our pages rather than Clerk's hosted ones; `/sign-up` hands a person who already has an account (`__clerk_status=sign_in`) to `/sign-in` with the invitation status and ticket unchanged and nothing else (`signInHandoffHref()` in `lib/invitation-handoff.ts`).
- **The landing page and sign-up** (the approved design of 2026-11-19, screens 01, 02-signup-1 and 1b; built in the landing PR, stacked on the admin-pages PR).
  The bare address, `/sign-in` and `/sign-up` draw one page (`LandingFrame`): the website's navigation, a heading and the website's "three ways" pictures, and a box with two tabs, Sign in and Set up a clinic.
  The tabs carry only `redirect_url` between them (`tabHref()` in `lib/landing.ts`), never an invitation ticket.
  **Sign in is Clerk's prebuilt `<SignIn />`**, restyled through Clerk's own `appearance` hooks (`components/landing/clerk-look.ts`): hash routing at `/`, path routing at `/sign-in`.
  It still does everything a sign-in can need: the email code, a second step, Continue with Google, an invited person with an account, and choosing a clinic when Clerk asks.
  **Set up a clinic is our form on Clerk's sign-up object** (`SetUpClinicForm`, a Clerk "custom flow" through `useSignUp()` from `@clerk/nextjs`, no new package), because the prebuilt `<SignUp />` cannot be limited to the two boxes the design asks for: Your name and Work email, then the six-digit code Clerk emails.
  The steps and their sentences are in `lib/sign-up-flow.ts`; Clerk's own error text is never shown.
  Clerk keeps everything: nothing typed is stored by us, and there is still no users table, password field or session cookie of our own.
  **Clerk's dashboard still asks for a password** at sign-up (and a first and last name; the one name box is split at its last word), checked on Clerk's development instance on 2026-11-19, so the form shows a third box, "Choose a password", after the code, which goes straight to Clerk; turning "Password" off in the Clerk dashboard (Evan's setting, both instances) removes that box with no code change, and sign-in already uses the email code only.
  When Clerk asks for a clinic to be set up first (its "choose an organization" step, on while the dashboard requires an organization), a brand-new person who belongs to no clinic and holds no invitation gets one made for them with a **provisional name** from their own name ("Jane Smith's clinic"), through Clerk's own browser client (`createOrganization`, then `setActive`, the two calls Clerk's own form makes; `setUpProvisionalClinic()` in `lib/sign-up-flow.ts`), because the design asks for the clinic's real name after payment.
  Clerk records them as its creator, so they become the account owner exactly as before, and our Clinic row is still made on first use.
  The real name is typed on Clinic branding (the existing name sync sends it to Clerk), until setup (pull request #5) asks for it in its first step.
  Anyone who already belongs to a clinic or holds an invitation, or when Clerk cannot be asked or refuses, gets Clerk's own `TaskChooseOrganization` in the box, the same step the prebuilt form showed, so nobody is pushed into a second clinic; a refresh after the clinic was made finds it in that list.
  A Google sign-up, and anyone who reaches `/onboarding` with no clinic, still names the clinic in Clerk's form there.
  Then the new account goes where a new account always went: the page it was sent from when that page is on this site (`safeReturnPath()`), otherwise `/onboarding`.
  An invitation's link still gets Clerk's prebuilt `<SignUp />`, unchanged, and so do Clerk's later sign-up steps under `/sign-up/...`; `/sign-up/sso-callback` is Clerk's `AuthenticateWithRedirectCallback`.
  **An invitation's page says "Accept your invitation to join <clinic>."** and draws no Sign in or Set up a clinic tabs, so nothing there offers to start a second clinic (Evan, 2026-11-20).
  The clinic's name is the one the server put in the invitation's own accept address when it sent it (`/sign-up?clinic=<name>`, `invitationAcceptUrl()` in `lib/invitation-name.ts`, called by `inviteSomeone()`), read back as display text only: cleaned, at most 80 characters, written as text, shown only when the visit also carries an invitation, and never used to decide anything (which clinic the person joins is the ticket's, checked by Clerk).
  Without a usable name it says "Accept your invitation."; an invitation sent before this change has none.
  That Clerk keeps our own query in the address it returns the person to is Clerk's behaviour, not checked against real Clerk; if it does not, the plain heading shows.
  Someone already signed in who opens `/sign-up` goes to `/onboarding`.
  Under Clerk's form, `ClerkLoading` and `ClerkFailed` say "Loading sign-in" or "We could not reach sign-in just now", so the box is never blank.
- **The Clerk forward is off, as an explicit choice** (Prompt B of the 2026-10-30 list, decided after the 2026-11-04 dashboard checks showed the browser never uses it).
  Clerk's middleware can pass requests under `/__clerk` on to Clerk's servers, and left to itself turns that on for a live key on a `*.vercel.app` address.
  `proxy.ts` sets `frontendApiProxy: { enabled: false }`, so it is off whatever the key or address, and the browser talks to Clerk directly, as it always has.
  `lib/proxy-clerk-forward.test.ts` fails if that line goes.
  The browser side has no such switch: Clerk would point the browser at `/__clerk` only if Vercel's production address were itself a `vercel.app` one, and ours is `learn.pulse3dmedia.com`, so it does not (the same test checks that rule).
  If the forward is ever wanted (Clerk can recommend it to get past ad blockers), it is a change of its own: turn it on here, and widen the Vercel firewall rule to cover `/__clerk` before it ships.
- **Public paths make fewer outside calls** (Prompt C of the 2026-10-30 list).
  Clerk's middleware looks at a request before our code does, and can ask Clerk's servers about what it finds there.
  So `proxy.ts` hands `/watch`, `/q`, `/api/health`, `/api/webhooks` and `/api/cron` (and everything under them) straight on without Clerk at all (`NO_CLERK_PATHS`): none of them needs to know who is signed in, and a paused link's renewal email and the setup reminder job still reach Clerk's backend client, which reads its keys from the environment.
  `/api/cron` is on the list also because Vercel calls it with an `Authorization` header carrying `CRON_SECRET`, which must reach the route (it checks the header itself) rather than be refused by the rule below.
  On every other path, a request carrying an `Authorization` header is answered 401 before Clerk sees it, because nobody signs in to this app with a header (staff use Clerk's cookie).
  `lib/proxy-clerk-calls.test.ts` counts the calls to Clerk and fails if either goes.
  **Never call `auth()` or `currentUser()` under those five paths**: without the middleware they throw.
  A path added there must be one that never needs a signed-in user.
  **What is left:** a sign-in "handshake" on `/`, the sign-in and sign-up pages and the staff pages is still checked with Clerk, because a real browser's sign-in uses it; a firewall rule is where it would be limited, a vendor setting for Evan.
- Clerk dashboard settings this depends on: Organizations enabled, and "Allow users to create organizations" on (so a new sign-up can set up a clinic).
  Since Clerk's organization panel was taken off our screens (Prompt L), two more are worth checking by hand, and are Evan's to set: admins cannot delete organizations, and `org:member` has no manage or delete permissions.
  Clerk's account menu (the user button) is still on our screens; it manages the person's own account, not the clinic.
- Clerk treats a session that still has a task to finish (such as choosing an organization) as signed out.
  The prebuilt `<SignIn />` component walks the user through that step itself.
- Keys: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, in `.env` and in Vercel (Production and Preview).
  Rule 7 applies.
  Mux has two of its own, `MUX_SIGNING_KEY_ID` (a setting) and `MUX_SIGNING_PRIVATE_KEY` (a secret; the base64 PEM from the Mux dashboard's Signing Keys page); with either missing a video that has moved to Mux is unavailable to its players, never served from the CDN, and the catalogue refuses a playback id (see "The video boundary").
  Uploading from the app adds three more: `MUX_TOKEN_ID` (a setting) and `MUX_TOKEN_SECRET` (a secret), an access token with Video permissions from the Mux dashboard's Access Tokens page, and `MUX_WEBHOOK_SECRET` (a secret, from the webhook's page in Mux, whose address is `/api/webhooks/mux`); with the token or the signing key missing the upload control says uploads are not set up here and pasting ids still works, and without the webhook secret the webhook answers "not configured" and "Check with Mux" does the same work by hand.
  Stripe's two (`STRIPE_SECRET_KEY`, a test key, and `STRIPE_WEBHOOK_SECRET`) live the same way; with neither set the app runs as before and the webhook answers "not configured".
  Two more that are settings, not secrets: `BILLING_CHECKOUT` (`"test"` opens test-mode checkout, for Preview and a developer's computer only; it is ignored on the production deployment, and against the production database) and the optional `APP_ORIGINS` (a custom domain Stripe may send people back to).
  Email has two of its own: `RESEND_API_KEY` (a secret) and `EMAIL_FROM` (the sender, on a domain verified in Resend; a setting, not a secret).
  With either missing no email is sent and nothing else changes.
  The optional `EMAIL_REPLY_TO` (a setting) is where a reply to the setup reminder goes, and `CRON_SECRET` (a secret, Production only) is what the daily job checks (see "The daily job: setup reminder emails").
- **Previews and production are kept apart** (set up by Evan in the 2026-11-04 dashboard checks, finished on 2026-11-05).
  **The database:** Vercel's Preview `DATABASE_URL` and `DIRECT_URL` point at the Neon `testing` branch, and Production's at production.
  Neon's Vercel integration used to make a copy of production for every preview and point that preview at it, which quietly overrode the testing address; the Vercel project was disconnected in Neon (Settings, Vercel, Disconnect) on 2026-11-05, so no `preview/...` branches and no per-branch `DATABASE_URL` rows are made any more.
  If a row marked "Preview (<branch name>)" ever appears under Vercel's environment variables, it beats the testing address for that branch and should be deleted.
  **Mux:** two Mux environments.
  Production's signing key, access token and webhook secret belong to Mux's Production environment; Preview's belong to the Development one.
  A video uploaded on a preview lands in the testing database and the Development environment, and a production video's playback id does not play on a preview (its key cannot sign it): the calm "did not load" panel.
  Never give Preview the production keys to get round that; upload a video on a preview instead.
  **What a preview shows:** the testing database's clinics, videos and the rows test runs leave behind (the "Vitest ..." clinics), never real ones.
  Signing in for the first time on a preview makes a new PENDING clinic for your organization there, which lands on Billing; open it by hand on the preview's `/pulse` (Overview: Open; Plan: categories and seats).
  Because every preview shares one database, two pull requests with different migrations open at once share it too, which is safe while migrations only add.
- **The demo site is a preview that stays put** (decided 2026-11-18).
  It is meant to run like a preview, on the Neon `testing` branch, Clerk's test instance, Stripe's test key and `BILLING_CHECKOUT=test`, at a steady address (planned: `demo.pulse3dmedia.com`) tied to one branch, and it shares the `testing` branch with every preview.
  Pulse staff open it from the "Open demo site" link on `/pulse` (`DEMO_SITE_URL`, set on Production only).
  Its leftover clinics are cleared with `npm run db:clear-demo-clinics` (see "The demo clean-up" in `docs/areas/database-and-migrations.md`).
  The vendor settings it needs (the domain, DNS, Clerk's allowed address, a Stripe test webhook that can reach it, `APP_ORIGINS`) are Evan's to set.

## Roles

Every person in a clinic has a **permission** (their role), and holds a **seat** or waits for one.
They are separate things and stay separate.
One person, the **account owner**, is special on both counts.

**Permission is the Clerk organization role.**
Clerk's free plan has exactly two roles and we use only those (custom roles are a paid add-on).
The People page calls them by plain names:

| Role | On the People page | Can |
|---|---|---|
| `org:admin` | Member with admin | `/admin` and everything under it: making share links (from any seated surgeon), QR codes and pamphlets, `/admin/people` (invite, revoke, admin on or off, remove, give a seat, the name patients see), branding (the clinic's name and logo included) and billing. Plus everything a member can do. |
| `org:member` | Member | `/library`, and sending links to patients from it when they hold a seat, and setting their own name and credential for patients from the Send panel. |

**Admin is a switch an admin flips for someone else**, on `/admin/people` (`setAdmin()` in `lib/seat-changes.ts`).
A person cannot turn admin on for themselves (only an admin can call it), switching it never changes the seat count, and the last admin cannot be made a plain member.
**Admin on or off and Remove take turns per clinic** (`withAdminChangeLock()` in `lib/db/admin-change-lock.ts`, a named Postgres lock, added in November 2026): their checks (is the person asking still an admin, asked of Clerk again under the lock; would this leave no admin?) and their Clerk write run one request at a time, so two admins switching each other off or removing each other at the same moment cannot leave the clinic with no admin.
The second waits, finds it is no longer an admin, and is refused (`lib/seat-changes.race.test.ts`, with a control).
Pulse staff setting the owner (`setOwnerByStaff()`) is two steps, admin on in Clerk, then the owner; if the second fails after the first, staff are told admin was switched on, never "Nothing was changed", and a Clerk that timed out is "we cannot be sure".

**The account owner** (`Clinic.ownerClerkUserId`, a Clerk user id) is the one person who runs the clinic's account.
Exactly one per clinic: whoever created the clinic's Clerk organization, recorded when the clinic's row is first made.
The owner:

- is always an admin, and cannot have admin switched off or be removed on our screens while they are owner.
  They hand the account over first;
- has no billing powers of their own: **any office admin may choose the plan, change it, cancel a waiting change and open Stripe's billing page, the account owner included** (decided by Evan on 2026-10-05, replacing the build plan's "billing belongs to the account owner").
  A clinic with no account owner can still have its billing changed by its admins;
- is the only person who does not need a seat, and may take one or give it up on `/admin/people` (an office manager who buys five gives all five to others), or take a free one from the library.
  Nobody else decides that for them, with one exception: **a solo owner is seated automatically when the clinic opens with exactly one seat** and nobody else holds or is invited to it (decided by the user on 2026-11-16, limited to one seat on 2026-11-18; see "Surgeon seats"), once per clinic, so an owner who then gives it up stays without one;
- hands the account over on `/admin/people` to someone who already has admin on, after a popup (`handOffOwner()`). The free spot moves with it (decided by Evan on 2026-09-25): if the new owner holds a seat and the old owner does not, the seat passes to the old owner in the same transaction as the owner change (`setClinicOwner()`), so the count is unchanged and nobody waits.
  If the new owner has no seat to pass on, the old owner, who stays in the clinic, needs one like everyone else (a free one, or waiting).
  Pulse staff setting a new owner does the same when the old owner is still in the clinic.
  The handoff is checked again under the clinic's row lock, so two tabs handing over at once end with one owner and one log entry.

**Clerk's own organization panel is not on our screens** (taken off in October 2026, Prompt L, after the 2026-10-08 security audit): its Members tab invited, removed and changed roles around our seat holds, owner protections and clinic log, and its General tab could offer to delete the organization.
Every people action is on `/admin/people`, and the name and logo are on `/admin/branding`.
Clerk's dashboard, a person's own account menu (leaving the organization), and an office admin acting in Clerk directly rather than on our screens can still change a membership behind the app's back: Clerk will not take membership management or deleting the organization away from its admin role (checked by Evan in the Clerk dashboard on 2026-11-04), so the owner protections hold on our screens only.
If the app hears nothing, the seat check notices such a change afterwards, and its log entry (under "seats") cannot say who made it or tell it from the owner leaving on their own (`lib/seat-changes.test.ts`, "the seat check", proves both).
When the seat check finds the owner is no longer a member it clears the owner and logs it; `/pulse` then flags the clinic "No account owner" (so is every clinic made before owners existed), and Pulse staff set a new one from the clinic's People tab (`setOwnerByStaff()`, which switches admin on for them if needed, logged under the staff member's name).
If the owner's admin is switched off outside our screens (the Clerk dashboard, or another admin in Clerk directly), `/admin/people` and `/pulse` say so, nothing is written to the log, and the owner is refused by the actions that ask Clerk live until an admin switches it back on from `/admin/people`.
**The Clerk webhook** (`POST /api/webhooks/clerk`, public like Stripe's and Mux's, the signature checked by Clerk's own `verifyWebhook` with `CLERK_WEBHOOK_SIGNING_SECRET` before anything is read; before that, a Content-Length over 256 KiB (413) or not a number (400) is refused without reading the body, `MAX_CLERK_WEBHOOK_BYTES` in `lib/body-size.ts`, and since only the header is looked at, `verifyWebhook` still reads the raw bytes itself; no package added) is how the app hears within seconds.
Clerk sends it a membership being added, changed or removed, and an organization being deleted (which events are sent, and the endpoint itself, are set by Evan in the Clerk dashboard, one endpoint per Clerk instance, each with its own secret in Vercel).
Only the organization id and the member's user id are read from it (`readClerkEvent()` in `lib/clerk-events.ts`, read its top comment first); `handleClerkEvent()` in `lib/clerk-webhook.ts` then runs the same seat check, which asks Clerk where things stand now, and compares the owner before and after.
When the owner has gone, or the owner's admin is off, or the organization was deleted, one entry goes in the clinic log under "Clerk" ("Changed in Clerk: ...", and for a deleted organization that a card subscription keeps charging until it is cancelled in Stripe), and Pulse staff are emailed at `ERROR_ALERT_EMAIL`, keyed by Clerk's delivery id so a repeated delivery sends nothing new.
A repeat of the newest entry is not written again; a notification about anyone else writes nothing of its own.
It finds a change, never prevents one, and cannot say who made it (Clerk's notification carries the request's address and browser, which are never read).
With no secret set it answers 503; a failure answers 500 and Clerk sends it again; a missed delivery leaves the seat check as the backstop.
A preview cannot receive it (Vercel's sign-in answers first), so the stand-in tests (`lib/clerk-webhook.test.ts`, `app/api/webhooks/clerk/route.test.ts`) and one real delivery after release are the checks.

**The seat** is described under "Surgeon seats".
A seat grants no admin permission and a role never takes a seat away, **with one exception, decided in Prompt 4 of the 2026-09-21 build plan: only someone holding a seat sends links to patients**, because every link is from a surgeon.
Whoever holds a seat may send from the library, and an admin may make a link from any seated person on `/admin/links`; nobody without a seat (the account owner who took none included) is either.

**Check permission on the server, in every page and every action**, with `isClinicAdmin()` from `lib/roles.ts` (which uses Clerk's `has({ role })`).
Hiding a button or an icon is a courtesy, never the check.
A member who opens `/admin` sees "This page is for your clinic's office admins."

**The highest-impact actions also ask Clerk live** (Prompt Q, October 2026).
`isClinicAdmin()` and the clinic come from Clerk's session token, which the browser refreshes about once a minute, so an admin who has just been made a plain member, or removed, still looks like an admin for up to that minute.
So, right before the change, `confirmAdminWithClerk(clinicId)` in `lib/clinic.ts` looks this person up in the clinic's own organization (read from the clinic's row) and refuses unless Clerk says admin.
It is asked by: every People action (`app/admin/people/actions.ts`), the billing actions that change something (checkout, confirming a plan change, cancelling a waiting change, Stripe's billing page, paying an invoice; not Review or the two "check" buttons, which change nothing), Printed QR code (making one), Retire and Replace on a printed QR code, the three saves on `/admin/branding` (the colour, font and phone; the clinic's name; the logo upload), and Confirm on `/admin/reactivate/<id>` (added for making a code and for Branding in audit Prompt L, November 2026: a printed code never runs out, and the name and logo are what every patient sees).
It costs one round trip to Clerk (usually well under half a second, with the five-second limit); its answer carries the person's name, which those actions used to ask Clerk for separately, so most of them make no extra call at all.
It fails closed: a Clerk that does not answer is "We could not reach sign-in just now to confirm you are still an office admin, so nothing was changed" (`ADMIN_CHECK_UNREACHABLE`).
**It is never added to the exam room's Send or to Create link** (the speed rule): those keep the token check, and `createShare()` checks the seat under a lock.

The helpers live in `lib/roles.ts` (`isClinicAdmin()`, server only), `lib/role-names.ts` (the two roles and their words, safe for the browser), `lib/people.ts` (the people and invitations in a clinic, read from and written to Clerk; it never touches `lib/db`) and `lib/seat-changes.ts` (the only way anyone's seat, role, invitation or ownership is changed).
