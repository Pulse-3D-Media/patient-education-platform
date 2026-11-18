/**
 * "Save or share this link" on the patient page (decided on
 * 2026-11-16): the rules, with no React, so they can be tested on their own.
 * The button itself is ShareLinkButton.tsx.
 *
 * What it does, all inside the patient's own phone:
 *
 *   - Where the browser has a share sheet (navigator.share: most phones),
 *     it opens that, with the page's own address and the procedure's name.
 *     The patient picks where it goes (Messages, a note, their email) and
 *     the phone sends it, not us.
 *   - Where there is none (most computers), it copies the address, and the
 *     page says "Link copied."
 *
 * Nothing is sent to our server and nothing is recorded: no request, no
 * count, no name, number or email asked for, nothing kept in the browser.
 * It never touches the video.
 */

/** The parts of the browser's `navigator` this uses, handed in so a test can stand in for them. */
export type ShareTools = {
  share?: (data: { title?: string; url?: string }) => Promise<void>;
  clipboard?: { writeText?: (text: string) => Promise<void> };
};

/**
 * What became of a press: the share sheet opened and was used ("shared"),
 * the patient closed it ("cancelled"), the address was copied ("copied"),
 * or neither could be done ("unable").
 */
export type ShareOutcome = "shared" | "cancelled" | "copied" | "unable";

export async function shareOrCopy(tools: ShareTools, link: { url: string; title: string }): Promise<ShareOutcome> {
  if (typeof tools.share === "function") {
    try {
      await tools.share({ title: link.title, url: link.url });
      return "shared";
    } catch (error) {
      // The patient closed the sheet: nothing more to do or say.
      if ((error as { name?: string } | null)?.name === "AbortError") return "cancelled";
      // Any other refusal (a browser that has the sheet but will not open it here): copy instead.
    }
  }
  if (typeof tools.clipboard?.writeText === "function") {
    try {
      await tools.clipboard.writeText(link.url);
      return "copied";
    } catch {
      return "unable";
    }
  }
  return "unable";
}

/** The words the page shows (and a screen reader hears) after a press. Nothing for a share or a closed sheet: the phone's own sheet was the answer. */
export function shareMessage(outcome: ShareOutcome): string {
  if (outcome === "copied") return "Link copied.";
  if (outcome === "unable") return "To save this link, copy the address at the top of your browser.";
  return "";
}

/**
 * Whether the button shows. On a patient link's page, always (the page is
 * drawn only for a working link). On a printed code's page, only once the
 * Play tap has made the visit's own link and the address has become
 * /watch/<that code>: before that the address is the poster's, which is not
 * the patient's to pass on.
 */
export function showShareButton(when: "now" | "once-own-link", pathname: string | null): boolean {
  if (when === "now") return true;
  return typeof pathname === "string" && pathname.startsWith("/watch/");
}
