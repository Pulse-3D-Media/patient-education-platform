import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { setClinicManagedByPulse, setClinicPlan, setClinicStatusByStaff, updateClinicDetails, upsertClinicForClerkOrg } from "./clinics";
import { NOTES_PAGE_SIZE, addClinicNote, countNotesForClinic, listNotesForClinic } from "./notes";

/**
 * The clinic log, against the real test database: notes are added and come
 * back newest first, one clinic never sees another's, and every change
 * staff make (status, plan, managed by Pulse, details) writes an entry of
 * its own, while a save that changes nothing writes none. Clinics made here
 * are deleted afterwards; their notes go with them (the relation cascades).
 */

const createdClinicIds: string[] = [];

async function makeClinic(label: string) {
  const clinic = await upsertClinicForClerkOrg(`org_test_${randomBytes(8).toString("hex")}`, { name: `Vitest notes ${label}`, logoUrl: null });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("addClinicNote and listNotesForClinic", () => {
  it("returns notes newest first, and only this clinic's", async () => {
    const clinicA = await makeClinic("A");
    const clinicB = await makeClinic("B");

    const first = await addClinicNote(clinicA, { kind: "STAFF", body: "First call, spoke to the office manager.", authorName: "Evan Miller" });
    // Postgres timestamps are fine-grained, but make sure the second note is later.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await addClinicNote(clinicA, { kind: "STAFF", body: "Sent the pricing sheet.", authorName: "Van Miller" });
    await addClinicNote(clinicB, { kind: "STAFF", body: "Belongs to B.", authorName: "Evan Miller" });

    const notesA = await listNotesForClinic(clinicA);
    expect(notesA.map((note) => note.id)).toEqual([second.id, first.id]);
    expect(notesA[0]).toMatchObject({ kind: "STAFF", body: "Sent the pricing sheet.", authorName: "Van Miller" });
    expect(notesA[0].createdAt).toBeInstanceOf(Date);

    const notesB = await listNotesForClinic(clinicB);
    expect(notesB.map((note) => note.body)).toEqual(["Belongs to B."]);
  });

  it("a status change by staff writes a STATUS entry with the reason", async () => {
    const clinicId = await makeClinic("status");

    await setClinicStatusByStaff(clinicId, "OPEN", "Paid by invoice through March.", "Evan Miller");

    const notes = await listNotesForClinic(clinicId);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: "STATUS",
      body: "Access set by hand to Open: Paid by invoice through March. Status is now Active.",
      authorName: "Evan Miller",
    });
  });

  it("a plan change writes an entry saying what changed, and saving the same plan again writes nothing", async () => {
    const clinicId = await makeClinic("plan");

    const first = await setClinicPlan(clinicId, ["KNEE", "HIP"], 3, "Evan Miller");
    expect(first.logged).toBe("Plan changed: categories set to Knee, Hip (was none); surgeon seats set to 3 (was 0).");
    expect(first.clinic.categories).toEqual(["KNEE", "HIP"]);

    // Same categories in a different order, same seats: not a change.
    const again = await setClinicPlan(clinicId, ["HIP", "KNEE"], 3, "Evan Miller");
    expect(again.logged).toBeNull();

    // Only the seats move: only the seats are mentioned.
    const seats = await setClinicPlan(clinicId, ["KNEE", "HIP"], 5, "Van Miller");
    expect(seats.logged).toBe("Plan changed: surgeon seats set to 5 (was 3).");

    const notes = await listNotesForClinic(clinicId);
    expect(notes.map((note) => [note.kind, note.authorName, note.body])).toEqual([
      ["STATUS", "Van Miller", "Plan changed: surgeon seats set to 5 (was 3)."],
      ["STATUS", "Evan Miller", "Plan changed: categories set to Knee, Hip (was none); surgeon seats set to 3 (was 0)."],
    ]);
  });

  it("managed by Pulse writes an entry when it flips, and nothing when it does not", async () => {
    const clinicId = await makeClinic("managed");

    expect((await setClinicManagedByPulse(clinicId, true, "Evan Miller")).logged).toBe("Managed by Pulse turned on.");
    expect((await setClinicManagedByPulse(clinicId, true, "Evan Miller")).logged).toBeNull();
    expect((await setClinicManagedByPulse(clinicId, false, "Evan Miller")).logged).toBe("Managed by Pulse turned off.");

    const notes = await listNotesForClinic(clinicId);
    expect(notes.map((note) => note.body)).toEqual(["Managed by Pulse turned off.", "Managed by Pulse turned on."]);
  });

  it("a details save lists each field that changed, and only those", async () => {
    const clinicId = await makeClinic("details");
    const unchanged = { noticeText: null, showPlaceholders: true, viewDaysOverride: null };

    const first = await updateClinicDetails(
      clinicId,
      { ...unchanged, name: "Vitest notes renamed", showPlaceholders: false, viewDaysOverride: 10 },
      "Evan Miller",
    );
    expect(first.logged).toBe(
      'Details changed: name changed from "Vitest notes details" to "Vitest notes renamed"; placeholder videos hidden; days a link works after the first play changed from the platform setting to 10.',
    );

    // Saving the form untouched writes nothing.
    const same = await updateClinicDetails(
      clinicId,
      { ...unchanged, name: "Vitest notes renamed", showPlaceholders: false, viewDaysOverride: 10 },
      "Evan Miller",
    );
    expect(same.logged).toBeNull();

    // Taking things away reads as removed or back to the platform setting.
    const cleared = await updateClinicDetails(
      clinicId,
      { ...unchanged, name: "Vitest notes renamed", noticeText: "Welcome to the pilot", showPlaceholders: false, viewDaysOverride: null },
      "Evan Miller",
    );
    expect(cleared.logged).toBe(
      'Details changed: notice set to "Welcome to the pilot"; days a link works after the first play changed from 10 to the platform setting.',
    );

    expect(await listNotesForClinic(clinicId)).toHaveLength(2);
  });

  it("reads the log a page at a time, newest first, with every note on exactly one page", async () => {
    const clinicId = await makeClinic("paged");
    const other = await makeClinic("paged other");
    const total = NOTES_PAGE_SIZE + 3;
    const base = Date.now() - 60 * 60 * 1000;
    // One insert. Note 0 is the oldest; the last three share one instant, which is where an unsteady order would show.
    await prisma.clinicNote.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        clinicId,
        kind: "STAFF" as const,
        body: `Note ${String(i).padStart(2, "0")}`,
        authorName: "Evan Miller",
        createdAt: new Date(base + Math.min(i, total - 3) * 1000),
      })),
    });
    await addClinicNote(other, { kind: "STAFF", body: "Belongs to the other clinic.", authorName: "Evan Miller" });

    expect(await countNotesForClinic(clinicId)).toBe(total);
    expect(await countNotesForClinic(other)).toBe(1);

    const first = await listNotesForClinic(clinicId);
    const second = await listNotesForClinic(clinicId, 2);
    expect(first).toHaveLength(NOTES_PAGE_SIZE);
    expect(second).toHaveLength(3);
    // The oldest three are on the second page, oldest last.
    expect(second.map((note) => note.body)).toEqual(["Note 02", "Note 01", "Note 00"]);
    // Newest first on the first page: its last entry is older than its first.
    expect(first[0].createdAt.getTime()).toBeGreaterThanOrEqual(first[NOTES_PAGE_SIZE - 1].createdAt.getTime());

    // No note twice, none missing, and nothing from the other clinic.
    const bodies = [...first, ...second].map((note) => note.body);
    expect(new Set(bodies).size).toBe(total);
    expect(bodies).not.toContain("Belongs to the other clinic.");

    // Asking again gives the same order, even for the notes written in the same instant.
    expect((await listNotesForClinic(clinicId)).map((note) => note.id)).toEqual(first.map((note) => note.id));

    // A page past the end is empty, and a page number that makes no sense is the first page.
    expect(await listNotesForClinic(clinicId, 3)).toEqual([]);
    expect((await listNotesForClinic(clinicId, 0)).map((note) => note.id)).toEqual(first.map((note) => note.id));
  });

  it("deleting a clinic takes its notes with it", async () => {
    const clinicId = await makeClinic("gone");
    await addClinicNote(clinicId, { kind: "STAFF", body: "Soon gone.", authorName: "Evan Miller" });

    await prisma.clinic.delete({ where: { id: clinicId } });
    createdClinicIds.splice(createdClinicIds.indexOf(clinicId), 1);

    expect(await prisma.clinicNote.count({ where: { clinicId } })).toBe(0);
  });
});
