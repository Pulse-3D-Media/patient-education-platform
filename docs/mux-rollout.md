# Moving the animations to Mux: what exists, how one moves, and how it moves back

Written with the `mux-video` pull request (Prompt 11, October 2026). It is the
inventory the prompt asked for before any file is removed from the Webflow CDN,
and the plain-words procedure for moving one video. **No file on the CDN is
deleted by that pull request or by this document.** Removing one is a separate
action, decided by Evan, after the checks under "Before a CDN file is removed"
are recorded here for that video.

## What the app refers to on the CDN today

Every address the app itself holds is in the database, on `Video` rows, and in
two seed scripts that only ever fill an empty database:

| Where | What | Notes |
|---|---|---|
| `Video.videoUrl` on rows that have one | The MP4 that plays, on `cdn.prod.website-files.com` | Read only through `lib/playback-auth.ts`. Optional since the `mux-upload` pull request: a video uploaded from the app has none. Where it exists it stays on the row after a move, as the record of the file and the way back; nothing plays from it while a playback id is set. |
| `Video.posterUrl` on some rows | A still for the library card | Keeps working after a move. Empty means the branded fallback, or, for a Mux video, the signed still Mux makes. |
| `prisma/seed-video.ts` | The first finished animation's CDN address | For a fresh database only. Never run on one in use. |
| `prisma/seed-placeholders.ts` | The sample animations' CDN addresses | The same. |
| `lib/brand.ts` (`LOGO_URL`) | The Pulse 3D logo picture | Not a video; untouched by the move. |

The exact list of rows and addresses is the Videos table on `/pulse/videos`,
which says `Mux`, `CDN`, `Other` or `No file` for each video
(`describeVideoSource()`), with "Upload in flight" under it while one is.
That table is the inventory; this file does not copy it, because a copy here
would go stale and this repository is public.

**The marketing website** (pulse3dmedia.com, built in Webflow) may embed the
same CDN files directly. The app has no way to know which. Before a file is
removed, someone checks the website's pages in Webflow for that file's address
(Webflow's Assets panel lists where an asset is used). Until that is done for a
file, assume the website uses it.

## What Evan sets up once (not code, and not in any PR)

1. A Mux account, with an environment for this app (Mux separates environments
   the way Stripe separates test and live).
2. In that environment, **Settings, Signing Keys, Generate new key**. Mux shows
   the key id and the private key (base64) once. They go into `.env` as
   `MUX_SIGNING_KEY_ID` and `MUX_SIGNING_PRIVATE_KEY`, and into Vercel's
   Production and Preview variables, and nowhere else (rule 7).
3. For uploading from the app (the `mux-upload` pull request, Prompt 11B):
   **Settings, Access Tokens, Generate new token**, with Video permissions
   (read and write) for that environment. Mux shows the token id and secret
   once. They go into `.env` and Vercel as `MUX_TOKEN_ID` and
   `MUX_TOKEN_SECRET`. The secret is a secret; the token never reaches a
   browser.
4. Also for uploading: **Settings, Webhooks, Create new webhook**, with the
   address `https://<the app's address>/api/webhooks/mux` (the production
   address for the production environment). Mux shows the signing secret;
   it goes into `.env` and Vercel as `MUX_WEBHOOK_SECRET`. A Vercel preview
   is behind Vercel's sign-in, so no webhook can reach it: there, and
   anywhere the webhook is not set up, the **Check with Mux** button on the
   video's page does the same work by hand.
5. A redeploy, so the running app has them. Until then every video plays from
   whatever it has (the CDN, or an asset moved by hand), the catalogue refuses
   to save a playback id (it cannot check one without the key), and the upload
   control says uploads are not set up here.

## Moving one video: upload from the app (the usual way)

1. On `/pulse/videos`, open the video. In the **File** card at the top,
   choose the finished MP4 and press **Upload to Mux**. The file goes from
   your browser straight to Mux, never through our server; the line under
   the button counts the megabytes sent. Keep the page open until it says
   the file has been sent.
2. The card then says **Mux is preparing it**. Usually a minute or two. The
   video keeps playing whatever it had (the CDN file, or its old Mux asset)
   the whole time; nothing changes for the library or for patients yet.
3. When Mux says the asset is ready, the new playback id and asset id are
   written onto the same video row (by the webhook, or by **Check with Mux**
   if you are on a preview or do not want to wait), and from then on the
   library and every link to that video, old ones included, play the new
   file through a signed Mux address. Nothing about a link changes: same
   code, same deadline, same pause-and-renew behaviour. The length is filled
   in from Mux if the box was empty.
4. For a placeholder: once it is ready, untick **Placeholder** and save (the
   usual yes-or-no first).
5. Check it (below). Leave the CDN file, if there is one, where it is.

If the upload fails (the connection dropped, Mux could not read the file, the
address ran out before the file arrived), the card says so and the video is
exactly as it was: choose the file and upload again. **Cancel upload** works
while Mux is still waiting for the file; once the file has arrived the asset
is being made and the honest answer is where it stands.

## Moving one video: by hand (still works)

1. In Mux, upload the finished MP4 as a new asset, and give it a playback id
   with the **signed** policy (Mux offers public or signed when the playback
   id is made). Note the playback id and the asset id.
2. On `/pulse/videos`, open the video, paste the playback id into **Mux
   playback id (signed)** and the asset id into **Mux asset id**, and save.
   Saving asks Mux about the id first: a public id, an unknown id, or a key
   Mux does not recognise is refused with the reason, and nothing changes. The
   CDN address, if there is one, stays in **Video address**.
3. From that save on, the library and every link to that video play through
   a signed Mux address, exactly as above.

## Moving one video back

For a video that still has a CDN address: clear the **Mux playback id** box
and save. The video plays from its CDN address again, for the library and
every link, at once. This is why the CDN address is kept on the row and why
the file is not removed: it is the undo.

**A video that lives in Mux only has no way back of that kind.** Decided by
Evan on 2026-10-05: at launch no video will be on the Webflow CDN, so the CDN
address is optional and a video uploaded from the app has none. Clearing its
playback id leaves nothing to play (the form says so before it saves) and the
video cannot be published until a file is uploaded again. The undo for a bad
upload is another upload: the previous asset is still in the Mux dashboard,
and its signed playback id can be pasted back by hand.

## Before a CDN file is removed (a separate, approved action)

For each video, recorded here with the date and who checked:

- it plays through Mux on `/watch/<code>` for a real link, on an iPhone
  (Safari's own HLS), an Android phone (hls.js), and a computer in Chrome or
  Edge and in Safari; the strip, the doctor's name, the placeholder mark and
  the controls are there; the first frame arrives quickly on cellular;
- its library card shows a picture (the chosen poster, or the signed still),
  and the player opens and plays;
- its text tracks, if the asset has any, show through the browser's own
  caption control;
- a token refresh has been seen to work (leave the player open past an hour,
  or shorten `TOKEN_LIFETIME_MS` on a preview) without the video stopping;
- the Webflow website has been checked for the file's address and either does
  not use it or has been changed not to;
- Evan has said, for that file, to remove it.

Removing a file the website still uses would break the website, not the app,
which is why the app's PR never does it.

## What a signed address does and does not do

It restricts who can **start** a new play, and for how long: an address is
good for an hour (less on a link with less time left), and a copied address
works until then. The player asks for a fresh one before it runs out, for as
long as the link or the clinic's plan still allows it; when access has ended
nothing is renewed. It does not stop a screenshot, a screen recording or every
form of copying, and it does not pull back video a phone has already loaded.
The CLAUDE.md section "The video boundary" is the rule; this file repeats it
so nobody reading only the rollout promises more.
