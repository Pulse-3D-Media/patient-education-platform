import type { NoteKind } from "@prisma/client";
import { prisma } from "./client";

/**
 * The running log on a clinic's /pulse page.
 *
 * Every entry is a ClinicNote row: something a staff member typed (kind
 * STAFF) or something the app recorded on its own because a change was
 * saved: the status, the plan, the details, managed by Pulse (kind STATUS,
 * named for the first such change; it now covers all of them). Entries are
 * only ever added, never edited or deleted, so the log reads as a true
 * history. Newest first.
 *
 * The app-written entries are made in lib/db/clinics.ts, in the same
 * transaction as the change they describe.
 *
 * Internal to Pulse 3D: nothing here is shown to a clinic. Takes clinicId
 * first like every clinic-owned query (rule 1).
 */

/** What one entry needs before it can be written. */
export type NewNote = {
  kind: NoteKind;
  body: string;
  /** The staff member's name, or "billing" and the like when the app wrote it. */
  authorName: string;
};

const NOTE_FIELDS = { id: true, kind: true, body: true, authorName: true, createdAt: true } as const;

/** Every note on one clinic, newest first. */
export async function listNotesForClinic(clinicId: string) {
  return prisma.clinicNote.findMany({
    where: { clinicId },
    select: NOTE_FIELDS,
    orderBy: { createdAt: "desc" },
  });
}

/** Add one entry to a clinic's log. Returns the new row. Throws if the clinic does not exist. */
export async function addClinicNote(clinicId: string, note: NewNote) {
  return prisma.clinicNote.create({
    data: { clinicId, kind: note.kind, body: note.body, authorName: note.authorName },
    select: NOTE_FIELDS,
  });
}
