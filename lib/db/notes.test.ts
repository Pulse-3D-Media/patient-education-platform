import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { setClinicStatusByStaff, upsertClinicForClerkOrg } from "./clinics";
import { addClinicNote, listNotesForClinic } from "./notes";

/**
 * The clinic log, against the real test database: notes are added and come
 * back newest first, one clinic never sees another's, and a status change
 * writes an entry of its own. Clinics made here are deleted afterwards;
 * their notes go with them (the relation cascades).
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

    await setClinicStatusByStaff(clinicId, "ACTIVE", "Paid by invoice through March", "Evan Miller");

    const notes = await listNotesForClinic(clinicId);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: "STATUS",
      body: "Status set to Active: Paid by invoice through March",
      authorName: "Evan Miller",
    });
  });

  it("deleting a clinic takes its notes with it", async () => {
    const clinicId = await makeClinic("gone");
    await addClinicNote(clinicId, { kind: "STAFF", body: "Soon gone.", authorName: "Evan Miller" });

    await prisma.clinic.delete({ where: { id: clinicId } });
    createdClinicIds.splice(createdClinicIds.indexOf(clinicId), 1);

    expect(await prisma.clinicNote.count({ where: { clinicId } })).toBe(0);
  });
});
