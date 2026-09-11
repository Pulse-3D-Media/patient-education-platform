import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { setClinicManagedByPulse, setClinicPlan, setClinicStatusByStaff, updateClinicDetails, upsertClinicForClerkOrg } from "./clinics";
import { addClinicNote, listNotesForClinic } from "./notes";

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

    await setClinicStatusByStaff(clinicId, "ACTIVE", "Paid by invoice through March", "Evan Miller");

    const notes = await listNotesForClinic(clinicId);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: "STATUS",
      body: "Status set to Active: Paid by invoice through March",
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
    const unchanged = { logoUrl: null, noticeText: null, showPlaceholders: true, viewDaysOverride: null };

    const first = await updateClinicDetails(
      clinicId,
      { ...unchanged, name: "Vitest notes renamed", phone: "8015550123", showPlaceholders: false, viewDaysOverride: 10 },
      "Evan Miller",
    );
    expect(first.logged).toBe(
      'Details changed: name changed from "Vitest notes details" to "Vitest notes renamed"; phone set to (801) 555-0123; placeholder videos hidden; days a link works after first view changed from the platform setting to 10.',
    );

    // Saving the form untouched writes nothing.
    const same = await updateClinicDetails(
      clinicId,
      { ...unchanged, name: "Vitest notes renamed", phone: "8015550123", showPlaceholders: false, viewDaysOverride: 10 },
      "Evan Miller",
    );
    expect(same.logged).toBeNull();

    // Taking things away reads as removed or back to the platform setting.
    const cleared = await updateClinicDetails(
      clinicId,
      { ...unchanged, name: "Vitest notes renamed", phone: null, noticeText: "Welcome to the pilot", showPlaceholders: false, viewDaysOverride: null },
      "Evan Miller",
    );
    expect(cleared.logged).toBe(
      'Details changed: phone removed (was (801) 555-0123); notice set to "Welcome to the pilot"; days a link works after first view changed from 10 to the platform setting.',
    );

    expect(await listNotesForClinic(clinicId)).toHaveLength(2);
  });

  it("deleting a clinic takes its notes with it", async () => {
    const clinicId = await makeClinic("gone");
    await addClinicNote(clinicId, { kind: "STAFF", body: "Soon gone.", authorName: "Evan Miller" });

    await prisma.clinic.delete({ where: { id: clinicId } });
    createdClinicIds.splice(createdClinicIds.indexOf(clinicId), 1);

    expect(await prisma.clinicNote.count({ where: { clinicId } })).toBe(0);
  });
});
