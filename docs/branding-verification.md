# Prompt 10: clinic branding and playback verification

This is an implementation and verification record, not a claim of patient or pilot readiness.

## Scope and migration

Continues the unfinished `branding` branch from reviewed `main` at `affa83f` (PR #22). GitHub main was checked directly before changes. Prompt 9's permanent QR feature is not used by this implementation; no unmerged numbered prompt is a technical prerequisite. The missing media-error and modal-focus fixes from the September review are included in the affected player flow.

Migration `20260918184417_add_clinic_branding` adds two nullable text columns, `Clinic.brandColor` and `Clinic.brandFont`. It changes no existing rows, fields, names or relationships. The migration was already applied on the configured Neon `testing` branch when this work resumed. Its completed migration record was verified after the repository guard confirmed that the endpoint differs from both production URLs. No reset, production migration, backfill or data script was run.

Future release order, only after review and an explicit release instruction: verify production point-in-time recovery, run `prisma migrate deploy` on production, then merge. Old code ignores the new optional columns, so it can run between migration and deployment. Recovery is to restore the previous app revision while retaining these harmless optional columns; database changes are fixed forward with an additive migration. No external assets or live vendor settings are changed by this PR.

## Local checks

`npm run lint`, `npx tsc --noEmit`, `git diff --check` and `npm run build` passed. The build initially hit a Windows Prisma DLL lock held by the existing local development server; stopping that verified local process resolved it. The final build contains no temporary preview route.

The latest full `npm test` run passed 381 tests in 35 files; one file could not initialize its connection to Neon testing, so its four tests were skipped and the command exited nonzero. Retrying that exact file (`app/watch/[code]/actions.test.ts`) passed all four tests. Thus all 385 tests across 36 files passed across the full run and the isolated retry, not in one uninterrupted run. The database safety guard remained enabled throughout. An earlier full run passed 384 tests before the additional regression test was added.

At PR preparation, Neon console access still required sign-in. The preview migration and signed-in Vercel walkthrough are pending; a successful build alone does not verify either. The PR remains draft until these and the device/content acceptance checks below are resolved.

Automated coverage includes two-clinic isolation, signed-out and member refusals, open/closed clinic admin permissions, Pulse authorization, invalid values, logged saves, repeat-save behavior, logo precedence, a forced overlap of concurrent branding saves (including a deliberately unlocked control), expiry and patient-page rendering. Clerk is mocked in action/page tests; those are not signed-in service checks.

## Browser observations, September 18, 2026

Environment: the Codex in-app Chromium browser on this Windows workstation, local Next.js development server. Used synthetic clinic names, phone numbers, logo fixtures and a locally generated silent WebM. No patient record, clinical animation, actual share code or real clinic was used. The temporary public harness was removed from the app before the final build and commit.

- Broken image and unsupported delayed image: fixed logo boxes retained their size and name fallback. During a pending slow image, the measured player box remained 256 by 120 CSS pixels in the then-current harness; the subsequent final player layout reserves a full 16:9 picture plus a separate 40px branding strip. A new valid logo loaded after a previously failed address.
- Synthetic inline playback reached the playing state, with native controls. The library player also opened with native controls and its placeholder label.
- Branding is in a reserved strip outside the video. The synthetic frame's top-right label remained unobscured in expanded playback.
- Forced lack of fullscreen support opened the patient overlay. The accessibility tree exposed only that dialog and its native controls; Close received focus, Tab reached the video, Escape returned focus to the enlargement button, and the original body scrolling styles were restored with no inert elements left behind.
- The library player returned focus to its Play card on Escape. A missing video produced a plain failure panel and focused Try again. Both authored retry buttons measured 48 CSS pixels high.
- The expanded failure dialog resized to 390 by 844 CSS pixels when the viewport changed. Narrow layout also showed no horizontal page overflow at a 319px viewport. These are viewport simulations, not phone/device results.
- A branding form with pale yellow showed the actual adjusted colour in its preview. Both a refused submission and a thrown server response kept the form available for retry. React's automatic form reset initially changed the radio selection; preventing that reset fixed the issue, and Merriweather remained selected after another refused save.
- Accessibility-tree inspection is not a full screen-reader session. Native container fullscreen, native video fullscreen, Picture-in-Picture, VoiceOver and TalkBack were not validated on physical devices.

No cold/warm first-frame timings are claimed from the synthetic local clip. The two-second target still needs representative clinical media and real network/device measurements.

## Second pass: independent audit, September 18, 2026 (evening)

A second review of the committed branch, by Claude, reading the code and re-running everything rather than relying on the record above.

Checks, all in one uninterrupted run each: `npm run lint` passed; `npx tsc --noEmit` passed; `npm test` passed **385 tests in 36 files** (no file skipped, no retry needed this time); `npm run build` passed and lists `/admin/branding`, with no temporary route. These were run again after the fixes below, with the same result.

Browser: headless Microsoft Edge on the same Windows workstation, driven over the DevTools protocol with real mouse and key events, against the local development server reading the Neon **testing** branch (never production). Eight made-up clinics with made-up names and the 555 phone number were created for it and removed afterwards. The video was the finished knee animation that is already public on the site's CDN. This is a desktop browser with phone-sized windows, not a phone.

What was seen on the patient page, at 390 by 844 unless said otherwise:

- Body copy 20px, smallest text 15px, no sideways scrolling. With a logo held back for five seconds, the video started playing first (108ms from tap to first frame, local machine, not a real-network figure) and the player did not move by a pixel when the logo arrived. A broken logo showed the clinic's name in the same box; no broken-image icon.
- The clinic mark sits in the 40px strip above the picture (strip 383 to 423px down the page, picture starting at 423px). Nothing is drawn over the picture except the "still loading" note, which only shows while the picture is stuck.
- Missing video file: the calm panel, "Try again" 48px tall, "Still stuck? Call" 48px tall with the right `tel:` link, no alarming words. A dropped connection followed by Try again played the video.
- A 104-character clinic name at 375px wide: no sideways scrolling, the mark shortened with an ellipsis.
- Keyboard only, with element full screen switched off to force the overlay: Tab reaches Play first, Enter plays, the overlay opens as a labelled modal dialog filling the window, focus lands on a 112 by 48 Close button, everything behind it is inert (nothing outside the dialog can be reached), turning the window sideways re-fits it, Escape closes it, focus returns to "Make the video bigger", the page returns to where it was scrolled, and the video never restarted.
- With element full screen available: the whole player goes full screen with Close and the clinic mark inside it, and comes back with focus restored and the video still playing.

Three defects found in the committed version and fixed in this pass:

1. The browser's control bar was showing through underneath "Tap to play" before the first tap (the video had its controls on from the start, where `main` turns them on at the first play). It also made the video, not the Play button, the first Tab stop. Restored: controls arrive with the first play.
2. The library player, which now uses the browser's controls, had gained a Download entry in Chrome's menu that the old player never had. Removed with `controlsList="nodownload"`, the same as the patient player. Tidiness, not protection.
3. The library player's placeholder mark was plain tinted text instead of the shared amber chip the rules file describes. It uses the shared chip again.

One limit found and written down rather than fixed, because it comes with the browser's own controls: in Chrome and Edge, while keyboard focus is inside the video's controls (after a click on the timeline, or tabbing into them), the page receives no key presses at all, so Escape does not close the patient overlay or the library player from there. Escape works from the Close button and from the video element itself, Tab reaches Close, and Close always works. In the library this is new with the move to the browser's controls; the old custom controls did not have it.

Not covered by this pass either: anything signed in (Clerk), the deployed preview, real phones and tablets, VoiceOver and TalkBack, captions, and real-network first-frame times. The table below still stands.

## Third pass: the library player's own controls restored, September 18, 2026 (night)

Evan looked at both library players side by side and chose the one he had approved: our own controls (scrub bar, play and start over, sound, full screen, keyboard shortcuts). The version with the browser's controls, described in the two passes above, is gone. So items 2 and 3 of the second pass, and its note about Escape in the library, no longer describe the code: the library player has no browser menu to hold a Download entry (`controlsList="nodownload"` is still set, as it was on `main`), and Escape closes it from anywhere because its controls are ordinary buttons. The Escape limit still applies to the patient page's enlarged view, which keeps the browser's controls on purpose.

What this PR still adds to that player: a 40px strip above the picture holding the amber placeholder chip and the clinic mark, so nothing that stays on screen is laid over the animation (on `main` the chip sat on the picture); the "did not load" panel with Try again, which carries on from where it stopped; the quiet "still loading" note; Space on a focused button now presses that button instead of pausing the video; and the scrub bar and volume take the clinic's colour.

The preview and production state also changed that day, on Evan's instruction: PR #22's owed migration was applied to production from `main`, and both pending migrations were applied to the `preview/branding` database. This PR's migration is still not on production.

Checks after the change, one uninterrupted run each: lint passed, `tsc` passed, `npm test` 385 passed in 36 files, build passed with no temporary route.

Browser (same set-up as the second pass: headless Edge over the DevTools protocol, a throwaway route since deleted, the public knee animation, windows not devices):

- Tablet landscape (1180 by 820): picture 1180 by 780 (820 on `main`, 714 with the browser's controls), strip 40px, neither the chip nor the mark over the picture, all five buttons 48 by 48, no sideways scroll. Phone (390 by 844): the same, picture 390 by 804.
- Keyboard, with focus on the player as it opens: Space pauses, K plays, the right arrow moves ten seconds, M mutes. Space on the focused Unmute button unmuted and did not pause. After a mouse click on the scrub bar, Escape closed the player, nothing was left inert and the page's scroll lock was released.
- A file that does not exist: "This video did not load.", Try again 94 by 48 with the keyboard's focus on it, Close still showing, the controls gone, no alarming words.
- The connection down when the player opens: the panel, then Try again plays. A failure sent at 0:40: Try again carried on at 0:41, and focus went back to the player.
- The connection dropping part-way did NOT reach the panel in Edge: the browser kept retrying by itself, the "still loading" note showed after eight seconds, and playback resumed on its own when the connection returned. That is the browser's behaviour, and the better outcome.

Still not covered: anything signed in, the deployed preview, real phones and tablets, screen readers, captions.

## Fourth pass: the staff shell, September 19, 2026

After Evan's walkthrough of the preview: the clinic's logo no longer sits on a white chip in the banner. It is at the top of the icon rail (now 80px wide and the full height of the screen), 56 by 56, above the library icon, with nothing behind it. The right of the banner reads "<clinic name>'s Patient Education Library" on every page (a name ending in s takes the apostrophe alone); on a phone, where the sentence does not fit, it is the clinic's name, and the logo rides in the banner at 36 by 36.

Checked in headless Edge through a throwaway route since deleted, at 1280, 820 and 390 wide: logo inside the rail and above the library icon, transparent behind it, no sideways scroll, nothing cut off at desktop and tablet widths, the category drawer opening flush against the wider rail, rail and banner staying pinned while the page scrolls, and no logo link at all for a clinic without a logo or with a broken one. Lint, `tsc`, 385 tests in 36 files and the build passed again.

Two things this makes visible, both stated to Evan: a wide wordmark logo is small in a 56px square (a square mark, which is what Clerk's organization logo normally is, fills it), and a dark logo with a transparent background is hard to see on the near-black rail now that the white chip is gone.

## Fifth pass: logo back in the banner, an admin menu, September 19, 2026

Evan's second look at the shell. The logo moved out of the rail and into a banner that now runs the full width of the screen, in a box 240 wide and 40 tall (150 wide on a phone), so a wordmark can stretch sideways; a square logo simply sits at the left of that box. Nothing is behind it. The "<clinic name>'s Patient Education Library" sentence is gone. A clinic with no logo, or a logo that fails to load, gets its name in words in the same place, so the clinic is still named on every page. Clerk's user button moved from the banner to the rail, directly under the admin icon (under the library icon for a member). The admin icon no longer jumps to the overview: it opens a pull-out menu, built the same way as the category menu, listing every admin section from `lib/admin-nav.ts` with the current one marked. Only one menu is open at a time; pressing the other icon swaps over. On a phone there is no rail, so the library icon, the logo, the admin icon and the user button all sit in the banner. The row of section tabs on the admin pages is unchanged.

Checked in headless Edge through a throwaway route since deleted (signed out, so Clerk's avatar itself was not drawn; only its reserved 44px slot was measured), at 1280, 820 and 390 wide: the logo is in the banner and not in the rail; the rail order is library, admin, avatar for an admin and library, avatar for a member; the old sentence is nowhere on the page; no sideways scroll; a missing or broken logo shows the clinic's name, cut off with an ellipsis when it is very long on a phone; the admin menu lists all six sections with their addresses, starts flush against the rail and directly under the banner, sets aria-expanded, swaps with the category menu, closes on Escape and on the backdrop, and choosing a section navigates (to the sign-in page in this signed-out check, with the right return address); the banner and rail stay pinned while the page scrolls; on a phone the admin menu opens from the banner with its own Close button. Not checked: the real Clerk avatar and its popover opening from the rail, which needs a signed-in person.

## Signed-in preview walkthrough for Evan

1. Open the PR's Vercel preview as Pulse staff. Open a synthetic clinic, then its **Branding** tab. Set an approved HTTPS logo, one colour, a font and a US phone number. Save, reload and inspect Notes for the correct actor and old/new values.
2. As that clinic's admin, open `/admin/branding`. Change the colour, font and phone; check the live previews. Confirm `/admin`, `/library` and a freshly opened patient page all use the clinic's identity. Open People > the organization panel > General > Update profile to edit the Clerk logo. Confirm the Clerk-uploaded logo takes priority on the next signed-in request.
3. Use a second clinic and a plain member account. Confirm the second clinic retains its own branding and a member cannot open or save the branding form. Confirm a paused/pending admin can still reach Billing but cannot edit branding.
4. Submit an invalid colour/phone, then disconnect the network during a save. The draft, including the font choice, must remain. Reconnect and retry; check that unchanged saves do not add duplicate audit entries. Save alternately as Pulse staff and clinic admin and inspect the sequence in Notes.
5. Test no logo, broken logo, slow logo and a long clinic name. Playback and layout must remain usable. Open expired and unpublished links belonging to the test clinic; a valid phone must show a tap-to-call link. A missing or invalid stored phone must not create a call link.
6. Play from the library and the patient page. Confirm Play, pause, seek, volume, captions when present, enlargement, Close and Escape. Change viewport/orientation, scroll and zoom; check focus returns to the opener and background content cannot receive modal focus. Disconnect during playback, reconnect and retry, confirming the resume position and no duplicate play count on the same page load.

## Outstanding acceptance: record actual devices and content

| Device/browser | Network | Cold first frame | Warm first frame | Inline/expanded, captions, focus, retry |
| --- | --- | --- | --- | --- |
| Real iPhone / Safari, model and OS required | Cellular and Wi-Fi | Not measured | Not measured | Not tested |
| Real iPad / Safari, model and OS required | Wi-Fi | Not measured | Not measured | Not tested |
| Representative Android / Chrome, model and OS required | Cellular and Wi-Fi | Not measured | Not measured | Not tested |
| Representative desktop / Chrome or Edge, version required | Typical clinic network | Not measured | Not measured | Not tested with clinical media |

Narrated pilot content needs usable, reviewed captions. This PR preserves native caption controls but does not add a caption asset store or prove that narrated catalogue videos contain captions. Record the actual clip and caption check before pilot release. The silent synthetic clip is not evidence for that acceptance requirement.

The printed pamphlet's pre-existing missing placeholder label and the Send request's pre-existing unhandled network rejection remain separate review items. This PR adds the placeholder label and modal focus handling to the Send panel because its styling is affected; it does not redesign link delivery.

## Light and dark staff screens, September 19, 2026

A separate PR (`light-mode`), built on the merged branding work. A clinic chooses Dark or Light on its Branding form; it applies to `/library` and `/admin` only. This section records what was actually checked. It is not a claim that light mode has been seen on a real tablet or phone, or signed in.

### Migration

`20260919212810_add_clinic_brand_theme` adds one nullable text column, `Clinic.brandTheme`. The SQL was produced by diffing two schema files with no database connection (`prisma migrate diff --from-schema-datamodel ... --script`) and read before use: `ALTER TABLE "Clinic" ADD COLUMN "brandTheme" TEXT;`. It was applied to the Neon `testing` branch only, with `migrate deploy`, after a script confirmed that endpoint differs from both production strings. Production and the preview database were not touched. `prisma format` was not run; the column was placed by hand next to `brandFont`. Old code ignores the column, so production can be migrated before the merge in the usual order.

### Checks, one uninterrupted run each

`npm run lint` passed. `npx tsc --noEmit` passed. `npm test` passed **402 tests in 36 files** (385 before this work). `npm run build` passed, lists `/admin/branding`, and contains no temporary route.

New or extended tests: the 216-colour sweep now covers the staff screens in light mode on every light surface (accent 3:1, text on the accent 4.5:1 at rest and hovered, the link shade 7:1 and dark rather than pale, the link shade and the page's ink on the accent's own 20% tint 4.5:1) and the dark-ground shades kept for the video player; a test that reads the light block of `app/globals.css` itself and measures every text token (4.5:1) and every edge token (3:1) on every light surface, plain and under both hover washes, plus amber on its own chip and the dimmed library tile's words; `parseBrandTheme`; the form reader (one text value, on the list, files and duplicates refused, dark stored as nothing); `updateClinicBranding` (mode logged, nothing-stored and dark treated as the same, nothing written when nothing changed, other clinics untouched); the forced overlap of two saves, now carrying the mode, with its unlocked control; both save actions (signed out, member, admin, closed clinic, another clinic with a forged id, Pulse staff, bad values including a mode that is not one of the two, repeat saves); and rendered pages (a light clinic's shell carries `data-theme="light"` for its admin and for a member, another clinic asked straight after is dark, a stored mode that is not understood reads as dark and never reaches the page, the form opens on what is saved). Clerk is mocked in the action and page tests; those are not signed-in checks.

### How the screens were looked at

Headless Microsoft Edge on the Windows workstation, driven over the DevTools protocol with real mouse events, against a local development server reading the Neon **testing** branch, never production. Claude cannot sign in to Clerk, so for this check only, the server was started with a throwaway stand-in for Clerk's server and browser packages (an alias in `next.config.ts` behind an environment variable, a stub folder, and one throwaway route for the library states the data could not produce). The stand-in chose the person by a cookie: admin, member or Pulse staff of one of eight made-up clinics (dark and light, each with no colour, a pale yellow `#ffe9a8` and a navy `#0a1433`, plus a paused clinic in each mode). **All of it was deleted before the commit**: the alias, the stubs, the route, the launch entry and the eight clinics with their links. The consequence is stated plainly: Clerk's real user menu and People panel were **not seen** in either mode. Only the colours handed to Clerk's provider were read back.

### Dark mode, before and after the token sweep

Nineteen screenshots at 1280 wide were taken on the code as merged (before any colour was changed) and again on the finished branch, with the same made-up data, and compared pixel by pixel by a script. The pages: library home, the category drawer open, a category page, the Send panel open, the player open, the admin overview, the admin menu open, Shared links, the cancel popup open, a link just made, People, Billing, Branding, Reports, the admins-only page, a member's library, a closed clinic's library, a closed clinic's Billing, and the coming-soon, locked and nothing-yet tiles and pages.

- **Identical, every pixel:** category page, player, admin overview, admin menu, People, Billing, Reports, admins-only, member's library, closed library, closed Billing, the library states. 12 of 19.
- **Differ only where a random share code is drawn:** the Send panel (the QR picture and the link, inside x 353 to 912, y 325 to 540), Shared links and the cancel popup (one line of link text, 431 pixels), a link just made (the new code in two places). Each run makes new links, so these cannot match. Everything around them matches.
- **Branding is 200px taller,** because it has a new Light or dark field. Expected.
- **Library home and the drawer over it differed in one of three runs,** by at most 3 out of 255 per channel, inside the pictures of two tiles only. The member's copy of the same page in the same run was identical, and an earlier run of the finished code was identical for this page too. It is the first page a fresh browser loads, and the difference is in how two large pictures were decoded, not in any colour this work touched. Reported because it moved, not because it matters.

Two things found by the comparison and fixed: the dialog backdrop had to be written as `color-mix(in oklab, #000 70%, transparent)` to match what Tailwind's `bg-black/70` produced (as `rgba(0,0,0,.7)` one row came out a single shade off), while the hairlines matched as `rgba()` and did not match as `color-mix`. Both are as measured, not as reasoned.

### Light mode

The same nineteen pages at **1280, 820 and 390 wide** for the light clinic, and at 1280 for the pale and navy clinics in both modes. These are browser windows of those sizes, not a tablet and not a phone. No sideways scrolling was seen at any width.

Contrast was measured in the browser by a script that reads each piece of text's real colour and everything really painted behind it (tints and hover washes composited, Tailwind's oklab tints converted), and the edge of every button, link-button and text box against what surrounds it. Words that sit on a picture (tile labels, the duration chip on a thumbnail) are listed by the script but not judged, since what is behind them is the picture. Result: **43 distinct pairs for the default light clinic, 45 each for the pale and the navy one, none below AA.** The lowest of each kind, default light clinic:

| What | Colour on ground | Measured | Needs |
| --- | --- | --- | --- |
| Button edge on the amber "needs a look" box | `#7f796c` on `#ece8de` | 3.53:1 | 3 |
| Button edge on the tinted link box | `#7f796c` on `#e9eef0` | 3.70:1 | 3 |
| Text-box and button edge on the page | `#7f796c` on `#fbfaf7` | 4.14:1 | 3 |
| Button edge on a white card | `#7f796c` on `#ffffff` | 4.33:1 | 3 |
| Amber "Paused" on its amber chip | `#684400` on `#d2c7b2` | 5.20:1 | 4.5 |
| Lit rail icon on its tint | `#1e5668` on `#c9d2d0` | 5.27:1 | 3 |
| "admin" badge on its tint | `#1e5668` on `#d2dde1` | 5.87:1 | 4.5 |
| Muted text on the page | `#52616a` on `#fbfaf7` | 6.14:1 | 4.5 |
| Muted text on a white card | `#52616a` on `#ffffff` | 6.41:1 | 4.5 |
| White on the red "Yes, cancel it" | `#ffffff` on `#a33a3a` | 6.51:1 | 4.5 |
| Body text on a selected radio card | `#3a4c56` on `#dde6e8` | 7.04:1 | 4.5 |
| Links | `#1e5668` on `#fbfaf7` | 7.78:1 | 4.5 |
| White on a filled button | `#ffffff` on `#1e5668` | 8.12:1 | 4.5 |
| Body text on the page | `#3a4c56` on `#fbfaf7` | 8.57:1 | 4.5 |
| Headings on the page | `#12202a` on `#fbfaf7` | 15.89:1 | 3 |

Pale yellow in light mode becomes an olive (`#948761`) with black words on it: button edge 3.41:1 on the page, black on the fill 5.9:1, lit icon `#574f39` 5.93:1. Navy is used as picked (it already stands out from a light page), with white words. The first measurement found one failure, amber on its chip at 4.31:1; the light amber was darkened from `#7a5200` to `#684400`. The unit test that reads the stylesheet then found three more that the pages happened not to show (muted text and the button edge on the rail colour under the stronger wash, and the dimmed tile's sentence over a black picture); those greys were darkened too.

Not measured by the script: hover and focus states (hover only adds a 6% wash, which the unit test covers for every text token; focus rings are the browser's own, or the link shade, which is 7:1 or better on every light surface by test), placeholder text inside a text box (muted on white, 6.41:1 by the table), and disabled buttons (exempt, and drawn at 50 to 60% on purpose).

### Behaviour, 23 checks, all passed

- The server's HTML already carries `data-theme` for a light admin, a dark admin and a light member, before any script runs. Nothing sets it afterwards.
- In the navy light clinic the player overlay is `data-theme="dark"`, black, with white words, and its scrub bar is `rgb(157,161,173)`, the dark-ground shade, not the navy `#0a1433` used on the light page.
- On a dark clinic's Branding page, choosing Light turned the "What your team sees" card white with dark ink at once; the patient card and the page itself did not change. A colour of "teal" was refused with its sentence and the form kept Light and "teal". With the colour fixed it saved; clicking Overview and then the logo showed `/admin` and `/library` in light **in the same document, with no reload**. A different clinic stayed dark. Reopened, the form was on Light; set back to Dark and saved twice, the second save said nothing changed.
- A member of the light clinic saw a light library, and on `/admin/branding` the admins-only page, in light, with no form.
- Clerk's provider was handed a white background, `#12202a` text and the light-ground accent with its text colour in a light clinic, and exactly the three values it had before (`colorPrimary`, `fontFamily`, `borderRadius`) in a dark one.
- As Pulse staff on the light clinic's Branding tab, the only `data-theme` on the page was the preview card's, the form opened on Light, and a text box measured `rgb(7,9,11)` with white text and a `rgba(255,255,255,.15)` edge, its old colours exactly.

### Seen along the way, not part of this work

The Send panel showed a raw database error once ("Invalid `prisma.$executeRaw()` invocation... transaction already closed") when the testing database was slow to wake and the five-second transaction ran out. The timeout is the environment; the sentence reaching the screen is review checklist item A1 (`app/library/[category]/actions.ts` returns `error.message`), already on `main`, and its own PR.

### What I am not happy with, or did not check

- Nothing signed in, nothing on the Vercel preview, no real iPad, iPhone or Android device, no screen reader. Clerk's real components in light mode are the biggest unknown: the variable names are the ones Clerk 7.9 documents in its types, but their effect was not seen.
- The amber "needs a look" box in light mode is a dull tan rather than a clear amber, because its tint is made from the (dark) amber text colour. Readable, not pretty.
- A pale brand colour becomes olive on light screens. That is the rule doing its job (a pale yellow button cannot be seen on a white page), but a clinic with a pale brand will like Dark better, and nothing on the form says so beyond the existing "we use a slightly darker shade" line and the live preview.
- The logo preview box on the Branding page is still white in both modes, as before, so in light mode it is a white box on a white card and shows the banner's look less honestly than it could. Left alone, because changing it would have moved pixels in dark mode.
- The page behind the app shell (`body`) still follows the computer's own dark-mode setting, as it did before this work. The shell covers the whole window, so it only shows if a browser lets the page be pulled past its edge.

### Signed-in walkthrough for Evan, on the Vercel preview

Before it works: apply the migration to the preview database with `node "Desktop\\Pulse 3D Patient Education App\\tools\\migrate-preview.mjs"` (it reads the connection string from the clipboard).

1. Sign in as the admin of a test clinic. Everything looks exactly as it does today (dark).
2. Open the admin menu, Branding. There is a new **Light or dark** field at the top of the form, with Dark selected.
3. Choose **Light** and do not save. The "What your team sees" card on the right turns white. The patient card above it and the page itself do not change.
4. Press Save branding. "Saved." appears. Click **Overview** in the row of tabs: the page is light, straight away, without a reload.
5. Click the logo (or clinic name) in the banner: the library is light. Picture tiles keep white labels; a locked or coming-soon tile is pale with dark words and a dashed edge.
6. Open a category and press Play: the player is black with white controls, as before, and the scrub bar is visible. Close it.
7. Press Send on a card: the panel is white, the QR code sits on white, the link box is tinted in your colour.
8. Open the admin menu, Shared links. Make a link, then press Cancel link on one: the popup is white with a red "Yes, cancel it". Press "No, keep it".
9. **Click your avatar in the rail, and open People and scroll to Clerk's panel.** These are the two things I could not see. They should be white panels with dark text and buttons in your colour, with nothing unreadable. Tell me what is wrong if anything is.
10. Try a pale brand colour and then a very dark one, saving each: buttons, the active tab's line, links and the player's scrub bar should all stay readable.
11. Sign in as a **member** of the same clinic: the library is light, and `/admin/branding` says the page is for office admins.
12. Sign in to a **second clinic**: it is still dark.
13. As Pulse staff, open `/pulse`, the first clinic, Branding: `/pulse` is dark, the form shows Light, and only the "What your team sees" card is light. Open Notes: "Branding changed: mode changed from Dark to Light." under the admin's name.
14. Set the first clinic back to Dark if you want it dark.
