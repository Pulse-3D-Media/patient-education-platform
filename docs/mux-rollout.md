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
| `Video.videoUrl` on every row | The MP4 that plays, on `cdn.prod.website-files.com` | Read only through `lib/playback-auth.ts`. Stays on the row after a move, as the record of the file and the way back; nothing plays from it while a playback id is set. |
| `Video.posterUrl` on some rows | A still for the library card | Keeps working after a move. Empty means the branded fallback, or, for a Mux video, the signed still Mux makes. |
| `prisma/seed-video.ts` | The first finished animation's CDN address | For a fresh database only. Never run on one in use. |
| `prisma/seed-placeholders.ts` | The sample animations' CDN addresses | The same. |
| `lib/brand.ts` (`LOGO_URL`) | The Pulse 3D logo picture | Not a video; untouched by the move. |

The exact list of rows and addresses is the Videos table on `/pulse/videos`,
which now says `Mux`, `CDN` or `Other` for each video (`describeVideoSource()`).
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
3. A redeploy, so the running app has them. Until then every video plays from
   the CDN exactly as before, and the catalogue refuses to save a playback id
   (it cannot check one without the key).

## Moving one video

1. In Mux, upload the finished MP4 (the same file the CDN holds) as a new
   asset, and give it a playback id with the **signed** policy (Mux offers
   public or signed when the playback id is made). Note the playback id and
   the asset id.
2. On `/pulse/videos`, open the video, paste the playback id into **Mux
   playback id (signed)** and the asset id into **Mux asset id**, and save.
   Saving asks Mux about the id first: a public id, an unknown id, or a key
   Mux does not recognise is refused with the reason, and nothing changes. The
   CDN address stays in **Video address**.
3. From that save on, the library and every link to that video, old ones
   included, play through a signed Mux address. Nothing about the link
   changes: same code, same deadline, same pause-and-renew behaviour.
4. Check it (below). Leave the CDN file where it is.

## Moving one video back

Clear the **Mux playback id** box and save. The video plays from its CDN
address again, for the library and every link, at once. This is why the CDN
address is kept on the row and why the file is not removed: it is the undo.

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
