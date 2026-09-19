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
