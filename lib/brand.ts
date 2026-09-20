/**
 * The Pulse 3D logo, served from the live site's CDN. It is the teal wordmark
 * on a transparent background, so it reads on both the staff shell's dark
 * ground and the patient page's warm light one. One address here means one
 * place to change it.
 */
export const LOGO_URL =
  "https://cdn.prod.website-files.com/69092ab4b2ae593d551bb95f/6a394f4daad9a6c8cc1d16a4_pulse3dmedia-logo-p-500.png";

/**
 * Where a clinic is sent to talk to Pulse 3D: the schedule-a-call page on
 * the public site. Hospitals, practices with more surgeons than a card plan
 * covers, and clinics Pulse manages all go here instead of to a card form.
 */
export const PULSE_CONTACT_URL = "https://www.pulse3dmedia.com/schedulecall";

/** The sentence that goes with the link, where only words fit (an error message, say). */
export const PULSE_CONTACT_WORDS = "Schedule a call with Pulse 3D at pulse3dmedia.com/schedulecall.";
