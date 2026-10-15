# The strip on the video, full screen and the library's controls: device checks

What changed (the player-overlay PR, from the 2026-10-08 huddle and Evan's choices on 2026-10-15):

- **The strip** (the clinic's logo and the doctor's name) is a slim, subtle row **above** the picture, not over it:
  44px tall, on the player's black, light grey words, 15px on a phone up to 18px. Nothing of ours is drawn over a
  playing picture any more, so nothing covers the browser's own buttons.
- **The patient player** uses the browser's own controls **including its own full-screen button**. Our "Make the
  video bigger" button and our own full-screen view are gone. The browser's full screen shows the video **alone**,
  without the strip, on every device (accepted).
- **The library player** keeps its own controls, laid out like a phone's or Vimeo's player: back 10 seconds, play or
  pause and forward 10 seconds in the middle; time, sound and full screen along the bottom with a thin progress bar;
  the procedure's name small at the top left; all fading away while the video plays. A finger tap shows or hides the
  controls; a mouse click plays or pauses. Close sits in the strip and never fades.

Why each is the way it is: `components/ui/ClinicMark.tsx`, `app/watch/[code]/WatchPlayer.tsx`,
`components/ui/VideoPlayer.tsx` and CLAUDE.md, "Clinic branding and dependable playback". The older checks of the 32px
band (October 5) are in `branding-verification.md`; they describe the band as it was then.

## What was seen on Claude's computer (2026-10-15), and what was not

Seen, in the Claude app's browser pane (Chromium), on the Neon testing branch with made-up links:

- Patient page at phone (375 by 812) and computer (1280 by 900) widths, before the first play and paused: the strip
  above the picture, the browser's own full-screen button back in its bar, no button of ours. A 48-character doctor's
  name ends in "..." on the strip (written in full above the player).
- The library player held sideways (812 by 375, like the Samsung screenshot), upright (375 by 812) and on a computer
  (1280 by 800): the strip right on top of the picture, the middle buttons, the bottom bar. A finger tap hides the
  controls, a second tap shows them, they fade by themselves after a moment while playing; a mouse click pauses;
  forward 10 seconds moves the video 10 seconds.

**Not seen, because nothing on this machine can do it:**

- **Any full screen.** The browser pane and headless Edge both leave a full-screen request pending, so neither the
  browser's own full screen on the patient page nor the library's Full screen button was seen working.
- **Safari**, and **any real phone or tablet** on a real network.

## The checks (Evan, on real devices)

Use the preview (Vercel's address for the `player-overlay` branch): a patient link made from `/admin/links`, and the
library signed in as someone holding a seat. For each device note the device, the browser and its version, the
network (cellular or clinic Wi-Fi), cold or warm start, and anything that fails.

1. **iPhone, Safari** (upright, then sideways)
   1. Patient link: the logo and doctor's name in a thin black row above the video; nothing over the picture.
   2. Tick the box, tap Play. Tap the picture: Safari's own buttons (full screen and picture-in-picture top left,
      sound top right) are all visible and nothing covers them.
   3. Safari's full-screen button: the iPhone's own player, video alone (expected).
   4. Library: open a procedure. Tap the picture: controls hide; tap again: they show. Back 10, play/pause, forward
      10, the progress bar, sound. Full screen: the iPhone's own player, video alone (expected). Close.
2. **iPad, Safari** (both ways round)
   1. As 1.1 to 1.3. Safari's own full screen shows the video alone.
   2. Library: as 1.4, then Full screen: the whole player fills the screen **with** the strip. Close or swipe out.
3. **Android phone, Chrome** (the Samsung)
   1. Patient link: as 1.1. Play: Chrome's bar along the bottom has its own full-screen button; tap it: the video
      alone, full screen. Turn the phone sideways while playing: does it go full screen by itself? (Fine either way
      now; note what happens.)
   2. Library, held sideways (compare with your earlier screenshot): the strip on top of the picture, controls
      over the picture only, nothing cut off at the right edge. Full screen: the whole player, strip included.
4. **Mac, Safari**: as 2.1 and 2.2, with a mouse (hover brings up Safari's own controls; click pauses in the library).
5. **Windows, Chrome, and Windows, Edge** (each)
   1. Patient link: the browser's own full-screen button in its bar works; double-clicking the picture also goes full
      screen; both show the video alone. Escape leaves.
   2. Library: clicking the picture pauses and plays; double-click and the Full screen button fill the screen with
      the strip at the top. The keyboard: space, the arrows, M, F, Escape closes.
6. **Readability**: on any phone, the strip's words on black, and the library's middle buttons over the white opening
   title card of Total Knee Replacement: all easy to read?

Record the results in the PR, or below this line, with the date.
