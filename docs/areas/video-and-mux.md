# Video playback and Mux

Moved out of the root `CLAUDE.md` in November 2026, word for word except where the pull request that moved it says otherwise.
A section name in quotes ("Billing state", "Roles") is a heading in one of the files under `docs/areas/`; the index at the end of the root `CLAUDE.md` says which.

## The video boundary

Never read `video.videoUrl` directly in a page to play it.
A player is handed a **`PlaybackSource`** (`lib/playback-source.ts`, pure, safe for the browser), and only one server-only module makes one:

```ts
// lib/playback-auth.ts (server only)
export function playbackForVideo(video, now, windowEnd): PlaybackSource          // the one place an address is built
export function playbackForShare(share, now): PlaybackSource                      // the patient: the link is the permission
export async function playbackForLibraryVideo(clinicId, videoId): PlaybackSource | null  // the library: canUseVideo() decides first
```

A source is one of three things.
**`file`**: a video still on the Webflow CDN, handed out as its plain address, as in Phase 1.
**`stream`**: a video that has moved to Mux (`Video.muxPlaybackId`, a SIGNED playback id), handed out as a signed HLS playlist and a signed still, with the moment the token stops working.
**`unavailable`**: a video that has moved to Mux for which no signed address could be made, because Mux signing is not configured on this deployment or the link has no time left, and also a video with neither a Mux id nor a CDN address (one whose upload has not finished; the form never lets one be published); the player shows its calm "did not load" panel, and **never the CDN file instead**: a video moved to protected playback is not quietly handed out unprotected because signing failed.
A Mux id wins; with no Mux id the CDN file plays; with neither, nothing.
**The CDN address is optional** (`Video.videoUrl` is nullable since October 2026; decided by Evan on 2026-10-05: at launch every animation lives in Mux only).
Where a video has one it is kept on the row as the record of where the file came from and as the way back (clear the playback id on `/pulse/videos` and the video plays from the CDN again); for a Mux-only video clearing the id leaves nothing to play, the form says so before it saves, and the video stays unpublished until a file is uploaded.
Nothing plays from the address while a playback id is set.

- **Who gets a token.**
  The patient's authorization is the link AND a recorded tick of the "for education only" box: the patient page hands out no address at all, and `POST /watch/<code>/accept` finds the link by its code, checks it is working and its video published, records the tick, and only then hands out the source, bounded by the link's deadline (`tokenExpiry()`: the usual hour, stretched to cover the video's length as Mux asks but never past three hours (`MAX_TOKEN_LIFETIME_MS`, so a mistyped length cannot make a token last all day, in the library and on a printed code's page too), cut to the link's deadline, nothing at all once it has passed).
  In the library the clinic comes from the server's own lookup of who is signed in, and `canUseVideo()` is asked with the same rule that lets a link be made; a video id on its own, sent by a browser, obtains nothing.
  Another clinic, a category off the plan, a hidden placeholder, an unpublished or unknown video, a clinic that is not open: nothing.
  A link already issued keeps its stream after its category leaves the plan, like every issued link.
- **Tokens are signed only on the server**, in `lib/mux.ts`, which starts with the `server-only` guard: RS256 over the claims Mux documents (`sub` the playback id, `aud` "v" for the video or "t" for a still, `exp`, `kid`), with Node's own crypto and no Mux package.
  A still's options ride in the token, never on the address.
  The two settings are `MUX_SIGNING_KEY_ID` and `MUX_SIGNING_PRIVATE_KEY` (the PEM as Mux hands it out, base64; a secret, rule 7), in `.env` and Vercel; with either missing nothing is signed and `muxIsConfigured()` says so.
  Nothing logs a token, a signed address or the key: a failure is its kind only.
- **The first play may move a link's deadline, and the token follows.**
  `recordPlay` (POST `/watch/<code>/play`) answers the first play of a Mux link with a fresh grant made for the new deadline, after reading the link again and checking it is still working and its video still published (a video unpublished in the moment after the play gets the play counted and no grant); the player swaps to it at its next refresh.
  A token never outlives the link, so a link with one minute left gets a one-minute token, not an hour; when a played link has less time left than the video needs, the page says so in plain words ("This link stops working in a few minutes") rather than letting the video stop part-way unexplained.
- **Mux stops a stream when its token expires, mid-play included** (its secure playback guide says so).
  So the player asks the server for a fresh grant a little before the token runs out (`refreshDelayMs()`, through `refreshPlayback`, POST `/watch/<code>/refresh`, for a patient and `refreshPlaybackAction` for the library), for as long as it is still authorized, and swaps where the video was, playing if it was playing.
  The server decides again each time.
  When access has ended (the link ran out, the category left the plan) nothing is renewed and the player says so calmly, with no Try again; a token already out simply runs down.
  On the patient page the page is then loaded again (once per page load), so the server draws the right calm page for the link: paused with Ask my clinic, finished, or not available.
  A phone that slept or a tab left in the background may run no timers, so when the page comes back into view a token that has run out, or is about to, is renewed at once (`refreshIfStale()` in `components/ui/video-source-loader.ts`), and a grant the first play handed back is dropped if its own token ran out while it waited (`grantIsUsable()`). A fresh address that goes on after a failure takes the calm panel away again, and Try again whose fresh address cannot be had brings the panel back rather than leaving a frozen picture.
- **How it plays.**
  `useVideoSource()` (`components/ui/useVideoSource.ts`, the machinery in `video-source-loader.ts`) puts the source on the element: on the patient page nothing until the box is ticked (`null`), then a file, written on the element so the browser starts fetching at once, or a stream; in the library, a file in the page's own HTML as before; a stream through the browser's own HLS where it has it (Safari on iPhone, iPad and Mac), and through **hls.js**, imported only then, everywhere else (on the patient page the download starts a moment sooner, at the tick, when the page was told the video is a stream: `warmUpStreamLibrary()`; hls.js is told not to fetch a picture bigger than the player, `capLevelToPlayerSize`, and steps up when the player goes full screen).
  Before the tick the patient page carries early-connection hints (`<link rel="preconnect">`) for the bare host the video will come from, Mux's or the CDN's, never an address (`earlyConnectionsFor()` in `lib/playback-auth.ts`).
  Which browsers have HLS of their own is decided by what they have, never by their name (`browserPrefersNativeHls()`: no MediaSource at all, which is an iPhone, or Safari's ManagedMediaSource): Chrome on Windows and Android browsers also answer "maybe" to the question and then play HLS badly or not at all, so they get hls.js.
  A grid card never loads a stream: a Mux video's card shows its signed still.
  Closing the player takes hls.js down and stops the timers.
  The strip on the video, the placeholder mark, the sender lines, `controlsList`, the browser's text tracks and both players' controls are unchanged by the engine.
- **Uploading from the app (the usual way in; decided by Evan on 2026-10-05).**
  On a video's page on `/pulse/videos` (and on the add form) a staff member chooses a file and presses Upload.
  The file goes from their browser STRAIGHT to Mux, never through our server: the server asks Mux for a one-time upload address (a Mux "direct upload", `startUpload()` in `lib/mux-uploads.ts`, through the `MuxUploadGateway` in `lib/mux.ts`, which is still the only file that talks to Mux), remembers the upload on the row (`Video.muxUploadId`, with `Video.muxUploadState` "waiting"), and hands the address to the browser, which sends the file there with one PUT (`useMuxUpload()` in `app/pulse/videos/useMuxUpload.ts`; the file box sits outside the form so a file is never posted to us).
  The address is for one file, runs out after `UPLOAD_TIMEOUT_SECONDS`, and is never logged; the access token never reaches the browser.
  The asset is made with the SIGNED policy and `UPLOAD_VIDEO_QUALITY` (Basic, one constant in `lib/mux.ts`), named after the video (its title and its row id go on the asset as Mux's `meta.title` and `meta.external_id`, so the Mux dashboard reads "Total Knee Replacement" and the asset can be matched to its row), with Mux's generated English captions (the track named "English", `CAPTION_LANGUAGE` and `CAPTION_TRACK_NAME` in `lib/mux.ts`), and with no MP4 downloads and no Mux Data.
  **The video keeps playing whatever it had the whole time**: nothing on the row but the two upload columns changes until Mux says the asset is ready, when `reconcileUpload()` writes the new playback id and asset id onto the SAME row (so every link keeps working and starts playing the new file), fills in the length if none was typed, and clears the upload columns.
  Two ways to hear that it is ready, and both end in that same function: the webhook (`POST /api/webhooks/mux`, public like Stripe's, a body whose Content-Length says it is over 256 KiB (413) or is not a number (400) refused before it is read (`MAX_MUX_WEBHOOK_BYTES` in `lib/body-size.ts`), the signature over the raw body checked with `verifyMuxWebhook()` before anything is read, five minutes' tolerance; it takes only the upload's id from the body and asks Mux where the upload stands now, so repeats, out-of-order deliveries and a notification about an upload a staff member has since replaced all end in the same row) and the Check with Mux button on the video's page (for a preview behind Vercel's sign-in, where no webhook can arrive).
  Every write names the upload it is about (`WHERE muxUploadId = ...`), so a replaced upload that finishes late changes nothing.
  While an upload is in flight the video's page re-reads the row every few seconds, so the card moves on by itself when the webhook finishes it.
  **A save of the form never wipes what an upload wrote** (found on production on 2026-10-07, when a form drawn before the upload finished was saved with its empty boxes): the form carries what it was showing for the playback id, the asset id and the length (`shownMuxPlaybackId`, `shownMuxAssetId`, `shownDurationSeconds`), and `videoFromForm()` keeps the row's current value for any of the three the staff member did not change; a value typed or cleared on purpose still wins.
  The title, category, poster, notes, Published and Placeholder are guarded the same way, under a row lock (see "Guard rails against a slip" in `docs/areas/pulse-dashboard-and-reports.md`).
  Only a signed playback id is ever written, and only after the same `checkPlaybackId()` the paste path runs has passed; if that check fails the upload is left in flight with the reason shown, for Check with Mux to finish once the key is right.
  A failed, cancelled or timed-out upload leaves the row as it was: "failed" stays on the row (with a Dismiss) until the staff member starts again; a cancellation (the Cancel upload button, which works only while Mux is still waiting for the file, or the Mux dashboard) leaves nothing.
  Replacing a placeholder is: choose the file, Upload, untick Placeholder once it is ready (the existing yes-or-no stays).
  No event table was added: a repeated notification is harmless because the reconcile reads Mux's current state, and a notification for an upload no row waits for is one log line.
  The in-memory stand-in for the tests is `lib/testing/fake-mux.ts`.
- **Captions (decided by Evan on 2026-11-16: Mux's generated captions and one CC button; on 2026-11-18, no separate review step: the owner watches each video through with captions on before publishing it).**
  Mux writes English captions from the narration and keeps them on the asset as a text track; nothing about them is stored in our database.
  A new upload asks for them (above).
  A video already in Mux gets them from **Add captions** on its page on `/pulse/videos` (`addCaptionsAction()`, Pulse staff only, through `requestCaptions()` in `lib/mux-captions.ts` and Mux's "generate track subtitles" call on the asset's sound track; it needs the asset id on the row).
  It asks Mux first and asks for nothing when English captions are ready or being made, and two presses at once take turns (`withCaptionRequestLock()` in `lib/db/caption-lock.ts`, a named Postgres lock held only while Mux is asked).
  A refusal says to upload the file again, which always asks for captions.
  The page's Captions card reads where they stand from Mux each time it is drawn (`readCaptionState()`: none, being made, ready, failed, no sound, or why Mux cannot be asked).
  **The page never waits on Mux**: what the row alone says (a CDN video, no asset id, Mux not set up) is drawn at once (`captionStateWithoutMux()`); otherwise the card says "Checking with Mux..." and Mux's answer is streamed in after the rest of the page (a Suspense boundary), given up after four seconds as "Could not check just now" with a Check again button, and once they are ready links to the caption text through an address signed on the server for an hour (`signedCaptionUrl()` in `lib/mux.ts`: the video's own token, audience "v", which Mux's secure playback guide says covers captions), with the way to correct a line in the Mux dashboard.
  **Patients can turn captions on as soon as Mux has made them.**
  Nothing in the app holds them back for a review (decided 2026-11-18: "just have Mux do the captions, no check needed"; the owner watches each video with captions on before publishing it, and the card says so).
  The player finds the track in the stream (see docs/areas/branding-and-players.md).
  A CDN file has none.
  Mux charges nothing extra for generated captions (its pricing page).
  Other languages, a caption editor and burned-in captions are not built.
- **The catalogue by hand.**
  A staff member can still put the signed playback id of an asset made in the Mux dashboard on the video's row on `/pulse/videos` (and, as a note, the asset id).
  Saving asks Mux first (`checkPlaybackId()`): the id's playlist must be refused without a token and answered with ours, which proves both that the policy is signed (Mux fails a token on a public id on purpose) and that this deployment's key is the right one.
  A public id, an unknown id, a key Mux does not know, Mux unreachable, or Mux not configured here (including a key that is set but cannot sign): refused, in words, nothing saved, never an exception (the same check runs inside the Mux webhook, where a throw would make Mux retry for ever).
  A length over four hours (`MAX_VIDEO_SECONDS` in `lib/video.ts`) is refused as a typo.
  One playback id belongs to one video (the unique column).
  A save that leaves the id as it was does not ask again.
  A video must have an address or a Mux id (or, when added, a file about to be uploaded) to be saved, and one of the first two to be published; the Videos table says Mux, CDN, Other or No file for each row, with "Upload in flight" under it while one is.
- **Content policy.**
  `stream.mux.com` and `*.mux.com` (where stream.mux.com hands the player on: `manifest-...` and `chunk-...` hosts, seen on the PR #74 preview) are in `media-src` and `connect-src` (hls.js fetches by script); stills come from `image.mux.com`, which is on the picture list (`lib/picture-hosts.ts`); `storage.googleapis.com`, where Mux's one-time upload addresses live, is in `connect-src` for the upload itself.

**Be honest about what that protects.**
A video still on the CDN has a public, permanent address: a share link's expiry limits the page, not the file, and that is the case for every video until it is moved.
A signed, expiring address restricts who can START a new play, and for how long: a copied address works until its token expires (an hour, or less on a link with less time left).
It does not stop screenshots or screen recording, does not stop every form of copying, and does not pull back a video that a phone has already buffered.
Never describe the media as protected beyond that, in copy or in a PR.
**The finished animations are not deleted from the Webflow CDN**, and will not be by any PR without Evan's separate instruction: the same files may serve the marketing website (see `docs/mux-rollout.md`).
