# The strip on the video and the Full screen button: device checks

What changed (the player-overlay PR, from the 2026-10-08 huddle): the strip on the video is a see-through dark wash
instead of a solid bar, the doctor's name on it is about twice as big (26px on a phone, up to 32px), and the patient
player's way to go big is a **Full screen** button on the picture, at the right end of the strip, instead of the "Make
the video bigger" button under the video. Chromium's own (dead, greyed-out) full-screen button is taken out of its
bar. Why each of these is the way it is: `components/ui/ClinicMark.tsx`, `app/watch/[code]/WatchPlayer.tsx` and
CLAUDE.md, "Clinic branding and dependable playback".

The older checks of the 32px band (October 5) are in `branding-verification.md`; they describe the band as it was then.

## What was seen on Claude's computer (2026-10-15), and what was not

Seen, in the Claude app's browser pane (Chromium), on the Neon testing branch with made-up links:

- Patient page at phone (375 by 812), tablet (768 by 1024) and computer (1280 by 900) widths, before the first play
  (box unticked and ticked), playing, paused, and the "did not load" panel.
- Our expanded view (the fallback when the browser cannot put part of a page full screen), at a computer width and a
  phone held sideways (812 by 375): the strip on the picture's own top edge, Escape closes it, focus goes back to the
  Full screen button.
- A 48-character doctor's name on a phone: 21px, two lines, nothing cut off. No doctor recorded: the logo only.
- The library player at phone, tablet and computer widths, with a placeholder: the strip, then the title row and Close
  straight under it.
- Chromium's own full-screen button gone from the patient player's bar.

**Not seen, because nothing on this machine can do it:**

- **Element full screen itself.** Both the browser pane and headless Edge leave a full-screen request pending forever,
  so the Full screen button's real full screen (the player filling the whole screen, strip included) was never drawn
  here. Its layout is the same as the expanded view, which was seen. A visible Edge window on Evan's screen would show
  it; that is check 5 below.
- **Safari.** No Safari runs on Windows. Safari's own buttons in the picture's top corners (see below) were found in
  WebKit's own media-controls code, not seen.
- **Any real phone or tablet**, and any real network.

## Safari's own buttons, in one paragraph

Safari draws its own controls ON the picture once the video has started: its **full-screen and picture-in-picture
buttons in the top-left corner**, its **sound button in the top-right corner**, and the play bar along the bottom (this
is WebKit's "inline media controls"; it is the same on an iPhone, an iPad and a Mac, and every browser on an iPhone is
Safari underneath). The strip lies over the top corners, so Safari's own buttons are under it: that is what was covered
at the huddle. They still work through the strip (it takes no taps), and the see-through wash shows them better than
the old solid band did, but our Full screen button sits right over Safari's sound button, and that one cannot be
tapped through ours. Chrome and Edge put all their controls along the bottom, so nothing of theirs is under the strip.

## The checks (Evan, on real devices)

Use a real patient link on the preview (Vercel's preview address for the `player-overlay` branch), made from
`/admin/links`, for a clinic with a logo and a doctor whose name is set. For each device, note the device, the
browser and its version, the network (cellular or clinic Wi-Fi), cold or warm start, and anything that fails.

1. **iPhone, Safari** (portrait, then sideways)
   1. Before Play: the logo at the top of the picture, the doctor's name under it, large; no Full screen button yet.
   2. Tick the box, tap Play. The Full screen button (an icon in a dark circle) appears at the top right of the
      picture. Tap the picture once so Safari shows its own controls: **are Safari's own top-left buttons (full
      screen, picture-in-picture) and top-right sound button visible under the strip, and can you still tap them?**
      Take a screenshot either way. **Is Safari's sound button under our Full screen button?**
   3. Tap our Full screen button. Expected on an iPhone: the player fills the page (our own expanded view, with
      Close at the top), the strip on the picture. Turn the phone sideways: it re-fits. Close comes back.
   4. Tap Safari's own full-screen button (top left, under the logo). Expected: the iPhone's own player, **without the
      strip**. That is the accepted limit; nothing to fix.
   5. Read the doctor's name at arm's length on the paused picture: big enough? Too big?
2. **iPad, Safari** (both ways round)
   1. As 1.1 and 1.2. The word "Full screen" shows beside the icon at this width.
   2. Tap our Full screen button. Expected: the whole player goes full screen (iPadOS can do that), **with** the strip
      and Close. Swipe or Close to leave.
   3. Safari's own full-screen button (top left): the iPad's own player, without the strip.
3. **Android phone, Chrome**
   1. As 1.1. Then play: Chrome's bar along the bottom has **no** full-screen button of its own.
   2. Tap our Full screen button: the phone goes full screen with the strip and Close. Back or Close leaves.
   3. Play, then turn the phone sideways **without** tapping anything: does Chrome go full screen by itself (it would
      show the video without the strip)? This was owed before this PR and is still owed.
4. **Mac, Safari**
   1. As 2.1 to 2.3, with a mouse: hover the picture to bring up Safari's own controls, and note what is under the
      strip.
5. **Windows, Chrome, and Windows, Edge** (each)
   1. The bar along the bottom has no full-screen button; ours, with the words, is at the top right of the picture.
   2. Click it: the screen fills, the strip at the top of the picture with the name at 32px, Close at the top left.
      Escape leaves. Double-clicking the picture does nothing.
6. **The library, on the iPad in the exam room** (signed in, holding a seat)
   1. Open a procedure: the strip at the top of the picture, then the title and Close under it, never overlapping.
   2. Our Full screen button (bottom right of the library's own controls): the whole player, strip included.
7. **Readability over the frames that matter.** On any phone, pause on the opening title card of Total Knee
   Replacement (white) and on a dark moment: the name readable on both? The title card's own title is partly under
   the strip on a phone; acceptable?

Record the results in the PR, or below this line, with the date.
