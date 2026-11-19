# app/watch: the patient's page

The rules that matter most here.
The detail is in `docs/areas/patient-page.md`; read it before editing anything in this folder.

- **Public, no login, ever, and about one thing:** one procedure, the clinic, calm plain words, large controls, the "for education only" box, and Play.
  No navigation, no sales, no tracking, no consent screen, no cookie banner.
- **No patient information, ever** (rule 2).
  Ask my clinic on a paused link has no box to type into.
- **No Server Actions under `app/watch`.**
  Every write and every grant is a POST route under `/watch/<code>/...`, so the Vercel rate limit covers it (see `docs/areas/security-headers.md`).
  A test fails on a `"use server"` line here.
- **No playable address before the box is ticked**, and a signed address only from `lib/playback-auth.ts` (see `docs/areas/video-and-mux.md`).
- **The wording is fixed** (`lib/education-note.ts`, and the expiry words in `lib/expiry.ts`): never "error", "invalid" or a status code, never red, never consent.
  Not changed without asking.
- **The speed rule:** the video starts in under two seconds from the Play tap.
  Do not add a step or a delay.
- An issued link follows only its own rules (its expiry, or the video being unpublished); this page reads no clinic plan, on purpose.
