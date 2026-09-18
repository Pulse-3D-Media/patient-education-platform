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
