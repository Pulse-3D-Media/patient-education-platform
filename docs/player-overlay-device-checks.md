# The Vimeo-style players: device checks

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
   4. Library: the same, plus Close top right.
2. **iPad, Safari** (both ways round)
   1. As 1.1 and 1.2. Full screen: the whole player fills the screen **with** the logo, title, name and our controls.
3. **Android phone, Chrome** (the Samsung)
   1. Patient link and library, held sideways and upright: as 1.1 and 1.2, nothing cut off at the edges.
   2. Full screen: the whole player, mark and controls included. Back leaves it.
4. **Mac, Safari**: with a mouse, play is bottom left and nothing is in the middle; a click on the picture pauses, a
   double-click is full screen (with the mark), moving the mouse away hides the controls while playing.
5. **Windows, Chrome, and Windows, Edge** (each): as 4, plus the keyboard on the focused player (space, the arrows,
   M, F; Escape closes the library's player).
6. **Logos**: on any device, a clinic with a wide wordmark logo and one with a square icon: is the crop acceptable?
   A clinic with no logo shows its initials.

Record the results in the PR, or below this line, with the date.
