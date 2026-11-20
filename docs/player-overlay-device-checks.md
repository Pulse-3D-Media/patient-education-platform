# The Vimeo-style players: device checks

## The player refresh (November 2026): what to look at on a real phone

What changed, after Evan's screenshots from a Samsung S22:

- **The clinic's mark** is smaller: the logo in its round frame (cropped to the circle, as before) and the doctor's name
  on one slim chip with slightly rounded corners. The video's title is no longer on the picture (the page writes it),
  except in full screen.
- **The controls cover less**: smaller middle buttons on a phone (still at least 44px to tap), and the dark fade at the
  bottom is only as tall as the time, sound, full screen and progress bar.
- **The big Play button** is a plain white circle with the triangle in the middle of the picture, with no words on
  screen: dimmed before the tick, ready after. A screen reader still hears what to do.
- **The patient page's first screen** is tighter on a phone (16px sides, every text one small step smaller, a little
  more space between blocks, a smaller logo), so the player and its Play button are in view before the box is ticked. **Held sideways** (not full screen), the
  logo and the sentence under the title step aside, the doctor and the clinic share one line, and the player is no
  taller than the screen.

Seen on Claude's computer (2026-11-16 and, after Evan's review, 2026-11-17; headless Edge with phone and tablet
emulation, a local copy of the database with made-up clinics): 360 by 640, 360 by 800, 390 by 844, 800 by 360,
768 by 1024 and 1280 by 800, before the tick, after it, playing and paused, a placeholder, a wide wordmark, a square
logo and no logo, and the library's watch page in dark and light.
**Not seen:** full screen (no browser here can enter it), Safari, and any real device on a real network.

On each device, note the device, browser and version, network, and anything that looks wrong:

1. **Android phone, Chrome (the Samsung S22), upright.** Open a patient link.
   1. Without scrolling: the logo, the doctor and clinic, the title, the sentence, the box AND the whole player with
      the Play circle should be on the screen (Chrome's own bars included).
   2. On the player, top left: the round logo and the doctor's name on a chip with slightly rounded corners, and
      nothing else; the animation's own title card is mostly clear of it.
   3. Tick, tap Play. While the controls show: the three middle buttons are smaller than before, the dark fade sits
      only behind the bottom row, and the time is easy to read over the white frames. Each button is easy to hit.
   4. Full screen: the video's title comes back above the doctor's name; everything else as before.
2. **The same phone, held sideways, NOT in full screen.** Reload the link: the doctor and clinic on one line, the
   title, the box, then the player, which starts on the first screen. Tick: the box folds away and nearly all of the
   player is in view without scrolling.
3. **iPhone, Safari, upright and sideways.** As 1 and 2. Full screen hands the video to the iPhone's own player (no
   mark, as before). Check the Play circle and the mark look the same as in the screenshots.
4. **iPad, Safari, both ways round**, a patient link and the library's watch page: the larger mark (a 48px circle) and larger middle buttons; full screen keeps the mark, the title and our controls.
5. **A clinic with a square logo, and one with none**: the round logo, or the initials, beside the doctor's name.
6. **The library's watch page in a dark clinic and a light clinic**: the Play circle and the mark look the same in both; the
   page around the player is unchanged.

## Earlier checks (2026-10-15)

What changed (the player-overlay PR, from the 2026-10-08 and 2026-10-15 huddles):

- **Both players** (the patient's link and the surgeon's library) now use our own controls, laid out like Vimeo's,
  from one shared implementation. On a phone or tablet: back 10 seconds, play or pause, forward 10 seconds in the
  middle. With a mouse: play at the bottom left. Along the bottom: the time, sound, full screen and a thin progress
  bar. Everything fades while the video plays and comes back on pause, a tap or mouse movement.
- **The clinic and the doctor on the video**: top left of the picture, the clinic's logo cropped into a round frame
  (or its initials), beside the video's title and the doctor's name on dark chips. It fades with the controls.
- **Full screen** is our own button in both players: the whole player, mark and controls included, on Android, an
  iPad and a computer. An iPhone hands the video to its own player, which shows the video alone (accepted).

Why each is the way it is: `components/ui/PlayerOverlay.tsx`, `components/ui/usePlayerControls.ts`,
`components/ui/ClinicMark.tsx`, `app/watch/[code]/WatchPlayer.tsx`, `components/ui/VideoPlayer.tsx` and CLAUDE.md,
"Clinic branding and dependable playback". The older checks of the 32px band (October 5) are in
`branding-verification.md`; they describe the band as it was then.

## What was seen on Claude's computer (2026-10-15), and what was not

Seen, in the Claude app's browser pane (Chromium), on the Neon testing branch with made-up links:

- Patient page on a phone (375 by 812, touch) before the first play (the mark top left, Play low and clear of it) and
  paused (the middle buttons, time, sound, full screen, progress bar, nothing overlapping on the 184px-tall picture);
  on a computer (1280 by 900, mouse) paused (play at the bottom left, nothing in the middle). The "did not load"
  panel, with the mark above it, Try again focused and the clinic's number.
- On the phone: the controls show on play, fade after about 2.6 seconds, a tap shows them, a second tap hides them,
  pausing brings them back; forward 10 moves the video 10 seconds; mute works. The play start and the tick were still
  recorded on the link.
- The library player on a phone held sideways (740 by 360, touch, like the Samsung), on a wide screen with a mouse,
  and with a placeholder video (the amber chip beside Close, staying when the rest fades).

**Not seen, because nothing on this machine can do it:**

- **Any full screen.** The browser pane and headless Edge both leave a full-screen request pending.
- **Safari**, and **any real phone or tablet** on a real network.

## The checks (Evan, on real devices)

Use the preview (Vercel's address for the `player-overlay` branch): a patient link made from `/admin/links`, and the
library signed in as someone holding a seat. For each device note the device, the browser and its version, the
network (cellular or clinic Wi-Fi), cold or warm start, and anything that fails.

1. **iPhone, Safari** (upright, then sideways)
   1. Patient link: before Play, the round logo, the title and the doctor's name top left; Play below them.
   2. Tick, tap Play. The controls show, then fade. Tap: they come back; tap again: they go. Back 10, forward 10,
      pause, the progress bar, sound.
   3. Full screen: the iPhone's own player, video alone (expected). Done brings you back where you were.
   4. Library: the same on a video's watch page (see 7), which has a back arrow above the player and no Close.
2. **iPad, Safari** (both ways round)
   1. As 1.1 and 1.2. Full screen: the whole player fills the screen **with** the logo, title, name and our controls.
3. **Android phone, Chrome** (the Samsung)
   1. Patient link and library, held sideways and upright: as 1.1 and 1.2, nothing cut off at the edges.
   2. Full screen: the whole player, mark and controls included. Back leaves it.
4. **Mac, Safari**: with a mouse, play is bottom left and nothing is in the middle; a click on the picture pauses, a
   double-click is full screen (with the mark), moving the mouse away hides the controls while playing.
5. **Windows, Chrome, and Windows, Edge** (each): as 4, plus the keyboard on the focused player (space, the arrows,
   M, F).
6. **Logos**: on any device, a clinic with a wide wordmark logo and one with a square icon: is the crop acceptable?
   A clinic with no logo shows its initials.

7. **The library's watch page** (the `library-watch` PR, 2026-10-15). Use the preview for the `library-watch`
   branch, signed in as someone holding a seat, then as a member without one. On an **iPad held sideways**, an **iPad
   held upright**, the **Samsung** (both ways) and a **computer**:
   1. Tap a card. The watch page opens with the video **paused**: one big Play button and the clinic's mark, nothing
      moving, no sound. Wait ten seconds: still nothing plays.
   2. Tap Play: the video starts at once, with sound (on an iPhone or iPad, check the sound is on).
   3. Sideways and on the computer, "More in <category>" is a column to the right and scrolls on its own; upright and
      on the phone, it is under the video. Nothing runs off the side of the screen.
   4. Under the video: the title, the category's round picture and name (a tap goes to the category), the length,
      the amber mark on a placeholder, then Favorite, Send to patient and Show QR on screen (a member sees Favorite
      only, and one sentence about the seat).
   5. Favorite fills the heart; it is still filled after going back to the home page, in My favorites.
   6. Show QR on screen: a large code on white. Scan it with another phone's camera: the patient page for that video
      opens. Done closes it. Send to patient opens the usual Send panel.
   7. Tap a video in "More in": its own page, paused. The back arrow returns to the previous video, then to where you
      started. Open a watch page in a new tab (or reload it): the back arrow goes to the video's category.
   8. Full screen from the watch page: as in 2 and 3 above for that device.
   9. A made-up address, `/library/watch/nothing`: the calm "We couldn't find that page" with a way back.

   **Seen on Claude's computer (2026-10-15, headless Edge and the app's browser pane, Neon testing branch, the Clerk
   stand-in):** each of the four layouts (phone 390 by 844, tablet upright 820 by 1180, tablet sideways 1180 by 820
   and 1024 by 768, desktop 1440 by 900) in dark and light, paused on opening with no sideways scroll; Play starting
   the video; one library play counted for one opening (none before Play, none for a pause and a replay); the heart
   saved; one link made by Show QR on screen, from the seated surgeon; the back arrow through two videos and back to
   the category, and to the category after a reload; an off-plan video and a made-up id not found with no video
   address in the page; a member without a seat given Favorite only; the round picture showing its letter when the
   image could not load. **Not seen:** full screen, Safari, scanning the code with a real phone, and any real device.

## Screen readers, the keyboard and the share button (the patient-a11y PR, 2026-11-16)

What changed on the patient page: each change of state (the video ready, loading, not loading, the link ended, a
printed code that cannot hand out a link, the clinic asked, a tap that did not go through) is said once through one
status region that is always on the page; the focus moves to the next thing when the button holding it goes away; the
player's controls come back when a key is pressed or the keyboard's focus arrives (and, since 2026-11-17, fade while the video plays for the keyboard too); the progress bar is read as words; every control has a
focus ring that shows over a light or dark picture; a browser without JavaScript gets a sentence saying so; and one
quiet button, "Save or share this link", sat under the video's length and deadline lines.

**That button was taken off on 2026-11-20 at Evan's request.** The record of what was seen on 2026-11-16 below is kept as it was; the steps to try have been changed to expect no such button.

None of this can be heard on Claude's computer: there is no VoiceOver or TalkBack here.

**Seen on Claude's computer (2026-11-16, the app's browser pane, Chromium, phone size 375 by 812, keyboard only, a
local dev server on a throwaway copy of the database with made-up rows):** Tab order before the tick is the box, Play,
then "Save or share this link", each with a visible ring; Space on the box moved the focus to Play and the status
region said "The video is ready. Tap Play to start." once; Enter on Play started the video and put a ring around the
player; Tab went through Back 10, Pause, Forward 10, Mute, Full screen and the progress bar, each with a white ring
and dark edge, the bar ringed as a whole and read as "4 seconds of 1 minute 49 seconds"; with the focus on the bar the
controls stayed up for over 5 seconds of playing, came back at once when the focus returned, and faded 2.7 seconds
after the focus left (on 2026-11-17 that was changed on Evan's word: the controls now fade while it plays with the
focus on them too; see 9.2). "Save or share this link" (no share sheet in that browser; the clipboard was stood in for) said
"Link copied.", made no request to any server, and the video kept playing. A printed code's page had no share button
until the Play tap, then the address became `/watch/...` and the button appeared under the deadline line. On a paused
link, Enter on Ask my clinic put the focus on "Your clinic has been asked" (then the status region also said the
confirmation; since the 2026-11-17 review it stays empty when the focus moves, so it is said once); no share button there. At 188 pixels wide (a phone at 200% zoom) the page first scrolled sideways (a long word in
the title) and the box's sentence was cut off at the box's edge; both were fixed and nothing runs past the edge now.
The accessibility tree: one main area, one heading, the box labelled with the whole sentence, the clinic's mark hidden
from screen readers, the page's language English, zoom not blocked. **Not seen:** VoiceOver, TalkBack, a real share
sheet, Safari, any real phone. Use a patient link made from `/admin/links` on the preview, and a printed code from the same page.

7. **iPhone, VoiceOver** (Settings, Accessibility, VoiceOver on; or ask Siri "turn on VoiceOver")
   1. Open the patient link. Swipe right through the page from the top. You should hear, in order: the doctor and the
      clinic, the procedure's name (a heading), the sentence under it, the box with the whole sentence "I understand
      this video is for education only..." as a checkbox, not checked, then "Play <procedure>, dimmed", with "Tick the
      box above to play", then the length, the deadline line, then Pulse 3D.
   2. Double-tap the box. The box goes away. Within a moment you should hear "The video is ready. Tap Play to start."
      once, and not again.
   3. Double-tap Play. You should hear "Loading the video." at most once, then the video plays. You should NOT hear the
      time ticking over while it plays.
   4. While it plays, swipe right onto the controls (back 10, pause, forward 10, sound, full screen, the progress bar).
      Each should be read with its name. On the progress bar you should hear something like "1 minute 5 seconds of 1
      minute 50 seconds"; swipe up or down on it moves the video.
   5. Turn on Airplane mode before step 2 on a fresh load, then tick: you should hear "We couldn't get the video
      ready. Check your connection, then try again." once, and the focus should land on Try again.
   6. Swipe on past the deadline line: there is no "Save or share this link" button, only Pulse 3D.
   7. A paused link: double-tap "Ask my clinic". The focus should land on the heading "Your clinic has been asked"
      (not the top of the page), and you should hear it once, not twice; swipe on for "Try this same link again in a
      day or so."
   8. A printed code (`/q/...`): no "Save or share this link" anywhere, before Play or after Play has started the
      video and the address bar shows `/watch/...`.
8. **Samsung S22, TalkBack** (Settings, Accessibility, TalkBack on; or hold both volume keys for three seconds)
   1. Repeat 7.1 to 7.8 with TalkBack's gestures (swipe right for next, double-tap to press).
   2. While the video plays, swipe onto one of the faded controls: it should come back into view, then fade again a
      moment later while the video plays. Double-tap it: it should act at once (a screen reader's press is not held
      back). Note whether it comes back (TalkBack may not move the browser's own focus; if not, a tap on the picture
      shows them).
9. **A computer with the keyboard only** (Chrome or Edge; no mouse)
   1. Press Tab from the top: the box (a ring around it), then Play (a white ring with a dark edge around the picture),
      and nothing after it. Space ticks the box; the focus is then on Play.
   2. Enter on Play: the video plays and the player has a ring around it. Tab moves through the controls, each with a
      ring, and the progress bar gets a ring around the whole bar. The arrow keys move ten seconds and do not scroll the
      page. Leave the keys alone for about three seconds while it plays: the controls fade, except the row holding
      the focused button, which stays drawn with its ring (2026-11-18). Press Enter: that button acts at once. Tab
      while they are faded: they come back and the focus moves on. Click the picture so the player itself has the
      focus, wait for the fade, then press Space: the controls come back and nothing else happens; Space again pauses.
      Pause: they stay up.
   3. Turn JavaScript off (Chrome: Settings, Privacy and security, Site settings, JavaScript) and reload: a grey box
      above the video says the browser needs JavaScript turned on, with the clinic's number.
   4. Zoom to 200% (Ctrl and +): nothing is cut off, and no sideways scrolling.

Record the results in the PR, or below this line, with the date.
