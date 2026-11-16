/**
 * One-off clean-up: take patient link codes out of old clinic log entries.
 * Run with:
 *
 *   npm run db:scrub-note-codes            (a dry run: counts only, writes nothing)
 *   npm run db:scrub-note-codes -- --apply (rewrites the entries)
 *
 * Until November 2026, turning a paused link back on wrote an entry that began
 * "Link <code> (<video>) turned back on: ...". The code is what plays the
 * video, and the log is kept for good, so each such entry is rewritten in
 * today's words: "A link for <video> (link id <row id>) turned back on: ...",
 * with everything after "turned back on:" kept exactly as it was, and the same
 * author and time. When the link cannot be found in that clinic (nothing in
 * the app deletes one, so this should not happen), the entry keeps the video's
 * name and loses the code, with no id.
 *
 * The clinic log is otherwise never edited. This is the one exception,
 * decided by Evan on 2026-11-16 (PR #92). Only those entries are touched:
 * anything else, including a staff note that happens to mention a link, is
 * left alone (lib/renewal-note.ts decides what counts as one).
 *
 * Safe to run again: a rewritten entry no longer matches, and each write only
 * lands if the entry still holds the words that were read. It prints counts
 * and entry ids, never a code or an entry's words.
 *
 * Against production it also needs --production (see prisma/preflight.ts):
 *   npm run db:scrub-note-codes -- --apply --production
 */
import { prisma } from "../lib/db/client";
import { errorKind } from "../lib/error-kind";
import { readOldRenewalNote, scrubbedRenewalNote } from "../lib/renewal-note";
import { preflight } from "./preflight";

/** Entries read at a time, so the log is never loaded whole. */
const BATCH = 500;

async function main() {
  const args = preflight();
  const unknown = args.filter((arg) => arg !== "--apply");
  if (unknown.length > 0) {
    console.error("Usage: npm run db:scrub-note-codes -- [--apply] [--production]");
    process.exit(1);
  }
  const apply = args.includes("--apply");

  let looked = 0;
  let matched = 0;
  let withId = 0;
  let withoutId = 0;
  let changedMeanwhile = 0;
  let cursor: string | undefined;

  for (;;) {
    // Only the entries that could be an old reactivation entry, a batch at a time.
    const notes = await prisma.clinicNote.findMany({
      where: { kind: "STATUS", body: { startsWith: "Link ", contains: " turned back on: " } },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, clinicId: true, body: true },
    });
    if (notes.length === 0) break;
    cursor = notes[notes.length - 1].id;

    for (const note of notes) {
      looked++;
      const old = readOldRenewalNote(note.body);
      if (!old) continue;
      matched++;

      // The link, looked for in the entry's own clinic only.
      const share = await prisma.share.findFirst({ where: { clinicId: note.clinicId, code: old.code }, select: { id: true } });
      const body = scrubbedRenewalNote(old, share?.id ?? null);
      if (share) withId++;
      else {
        withoutId++;
        console.log(`  entry ${note.id}: its link was not found in its clinic, so it keeps the video's name only`);
      }
      if (!apply) continue;

      // Lands only if the entry still holds the words just read.
      const { count } = await prisma.clinicNote.updateMany({ where: { id: note.id, body: note.body }, data: { body } });
      if (count === 0) changedMeanwhile++;
    }
  }

  console.log(`Entries looked at: ${looked}. Old reactivation entries found: ${matched}.`);
  console.log(`  named by link id: ${withId}; named by video only: ${withoutId}.`);
  if (apply) {
    console.log(`Rewritten: ${matched - changedMeanwhile}.${changedMeanwhile ? ` Not rewritten because the entry changed while this ran: ${changedMeanwhile} (run again).` : ""}`);
  } else {
    console.log("Dry run: nothing was written. Add --apply to rewrite them.");
  }
}

main()
  .catch((error) => {
    // The kind of failure only, never its message (lib/error-kind.ts).
    console.error("Scrubbing the log failed:", errorKind(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
