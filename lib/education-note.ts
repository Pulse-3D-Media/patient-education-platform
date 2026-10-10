/**
 * The "for education only" words on the patient page and the printed
 * pamphlet. Pure, so the page, the pamphlet and the server read the same
 * words. Never add the word "consent", and never suggest that ticking the box
 * replaces or satisfies informed consent: the product supports the consent
 * conversation, it does not take part in it (see "Writing copy" in CLAUDE.md).
 * Neither wording is changed without asking.
 */

/**
 * The "for education only" sentence on the printed pamphlet. Van's wording,
 * approved by Evan on 2026-10-02. It also sat under the video on the patient
 * page until the box below arrived; Evan chose on 2026-10-10 to let the box
 * be the patient page's one statement (option B), so it is the pamphlet's now.
 */
export const EDUCATION_ONLY =
  "This video is for education only. It is not medical advice. Ask your doctor about anything you are unsure of.";

/**
 * The box a patient ticks before the video will play (decided by Evan and Van
 * at the huddle on 2026-10-08), and the patient page's only "for education
 * only" statement. The words and their version live together
 * here ON PURPOSE: changing the words means changing the version, so the
 * record on each link (Share.disclaimerVersion) always says which words were
 * ticked. Use the date the new words were approved as the version.
 */
export const DISCLAIMER = {
  version: "2026-10-08",
  text: "I understand this video is for education only. It is not medical advice, and I will ask my doctor about anything I am unsure of.",
} as const;

/** What a well-formed version looks like ("2026-10-08"), whether or not it is the current one. */
export function isDisclaimerVersionShape(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * What a patient page sent as the version it showed: the current one, a
 * well-formed but older or newer one (the page was drawn by another
 * deployment, around a release that changed the words), or junk. The routes
 * record only the current one; a "stale" page is asked to reload, so the
 * patient ticks the words that will be recorded.
 */
export function judgeAcceptedVersion(value: unknown): "current" | "stale" | "malformed" {
  if (!isDisclaimerVersionShape(value)) return "malformed";
  return value === DISCLAIMER.version ? "current" : "stale";
}
