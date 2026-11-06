/**
 * The full Pulse 3D logo (the PULSE 3D wordmark, the heartbeat line either
 * side, MEDIA underneath), a fixed file in public/ served from our own
 * address, so the content policy has nothing to add and no other site is
 * asked for it. Transparent, in mid teal, so it reads on the staff screens'
 * near-black and on white.
 *
 * Made in November 2026 from the website's artwork (logo-full.png, 1801 by
 * 603, about 390 KB): cropped to the artwork's own edges, scaled to 144
 * pixels tall (three times the tallest place it is drawn, 48px) and reduced
 * to 256 colours, which leaves about 14 KB. To change it, make a new file the
 * same way and update the two numbers below.
 *
 * Every page draws it with a fixed height and `w-auto`, plus these width and
 * height attributes, so the browser keeps its proportions (never stretched or
 * cropped) and saves its space before it has loaded.
 */
export const LOGO_URL = "/pulse-3d-logo.png";
export const LOGO_WIDTH = 450;
export const LOGO_HEIGHT = 144;

/**
 * Where a clinic is sent to talk to Pulse 3D: the schedule-a-call page on
 * the public site. Hospitals, practices with more surgeons than a card plan
 * covers, and clinics Pulse manages all go here instead of to a card form.
 */
export const PULSE_CONTACT_URL = "https://www.pulse3dmedia.com/schedulecall";

/** The sentence that goes with the link, where only words fit (an error message, say). */
export const PULSE_CONTACT_WORDS = "Schedule a call with Pulse 3D at pulse3dmedia.com/schedulecall.";
