/**
 * How the clinic log names a link that was turned back on, pure.
 *
 * The log names the link by its video and its row id, never by its code: the
 * code is what plays the video, and the log is kept for good (the renewal
 * email and /admin/reactivate avoid the code for the same reason).
 *
 * Entries written before November 2026 began "Link <code> (<video>) turned
 * back on: ...". readOldRenewalNote() recognises one, and scrubbedRenewalNote()
 * writes the same entry in today's words, for the one-off clean-up script
 * (prisma/scrub-note-codes.ts). Everything after "turned back on:" is kept
 * exactly as it was written.
 */

/** "A link for Total Knee Replacement (link id ck...)", or without the id when none is known. */
export function linkNoteName(videoTitle: string, shareId: string | null): string {
  return shareId ? `A link for ${videoTitle} (link id ${shareId})` : `A link for ${videoTitle}`;
}

/**
 * The short end of a link's row id ("...a3f9k2"), for a staff screen that
 * lists links (the Links tab on /pulse). Enough to tell two links for the
 * same video apart and to find the row; the row id plays nothing, unlike
 * the link's code, which is never shown there.
 */
export function shortLinkId(shareId: string): string {
  return `...${shareId.slice(-6)}`;
}

/** The part every reactivation entry shares, old and new. */
const TURNED_BACK_ON = " turned back on: ";

/**
 * An old entry: "Link <code> (<video>) turned back on: <rest>". A code is
 * lowercase letters and digits (6, 10 or 16 of them so far). The video's name
 * may itself hold brackets, so it runs to the last ") turned back on: ".
 */
const OLD_ENTRY = /^Link ([a-z0-9]{6,32}) \((.*)\) turned back on: (.*)$/;

export type OldRenewalNote = { code: string; videoTitle: string; rest: string };

/** The parts of an old reactivation entry, or null for any other entry (today's words included). */
export function readOldRenewalNote(body: string): OldRenewalNote | null {
  const match = OLD_ENTRY.exec(body);
  if (!match) return null;
  return { code: match[1], videoTitle: match[2], rest: match[3] };
}

/** The same entry in today's words: the code gone, the link's row id in its place when it is known. */
export function scrubbedRenewalNote(old: OldRenewalNote, shareId: string | null): string {
  return `${linkNoteName(old.videoTitle, shareId)}${TURNED_BACK_ON}${old.rest}`;
}
