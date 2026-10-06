import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { createShare } from "@/lib/db/shares";
import { ShareTermsError } from "@/lib/expiry";
import { getCurrentClinicId } from "@/lib/clinic";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import { refreshPlaybackAction, sendShareAction, setMyPatientNameAction } from "./actions";

/**
 * The Server Action behind the library's Send button, with Clerk replaced
 * by the in-memory stand-in (lib/testing/fake-clerk.ts) and the database
 * real (the Neon testing branch). What these prove: anyone holding a seat
 * at an open clinic can send a video the clinic may use, and the link is
 * from them, with their name copied onto it; someone without a seat is
 * refused and nothing is written; the same video is refused for a clinic whose plan does not
 * include its category, for a clinic shown finished animations only when
 * it is a placeholder, and for a clinic that is not open; a refusal is a
 * plain sentence and writes nothing; and the clinic comes from the
 * signed-in user, since the action takes nothing but a video id; and
 * when something breaks that the person can do nothing about, the panel
 * gets one plain sentence while the technical detail goes to the server
 * log and nowhere else.
 */

// The real createShare and the real clinic lookup, each wrapped so ONE call can be made to fail.
// Every other call goes to the real thing (resetAllMocks puts the real one back before each test).
vi.mock("@/lib/db/shares", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db/shares")>();
  return { ...real, createShare: vi.fn(real.createShare) };
});
vi.mock("@/lib/clinic", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/clinic")>();
  return { ...real, getCurrentClinicId: vi.fn(real.getCurrentClinicId) };
});

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());

// getBaseUrl() reads the request headers; there is no request here.
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
}));

function fakeOrgId() {
  return `org_test_${randomBytes(8).toString("hex")}`;
}

/** The seated surgeon (a plain member, not an admin) of each organization, by organization id. */
const surgeonOf = new Map<string, string>();
/** A member of the Knee clinic who holds no seat. */
const noSeat = `user_noseat${randomBytes(6).toString("hex")}`;

/** Sign in as that organization's seated surgeon, or as someone else in it, or sign out (null). */
function signInAs(orgId: string | null, userId?: string) {
  fakeClerk.signIn(orgId ? (userId ?? surgeonOf.get(orgId) ?? null) : null, orgId);
}

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];

const orgKnee = fakeOrgId();
const orgHip = fakeOrgId();
const orgFinishedOnly = fakeOrgId();
const orgPending = fakeOrgId();
let kneeClinic = "";
let hipClinic = "";
let finishedOnlyClinic = "";
/** A published Knee placeholder. */
let placeholderId = "";
let unpublishedId = "";

/** A clinic, its organization in the stand-in, and one surgeon ("Dr. Jo <n>") who is a plain member holding a seat. */
async function makeClinic(name: string, clerkOrgId: string, data: { status?: "ACTIVE" | "PENDING"; categories?: ("KNEE" | "HIP")[]; showPlaceholders?: boolean }) {
  const surgeon = `user_surgeon${randomBytes(6).toString("hex")}`;
  surgeonOf.set(clerkOrgId, surgeon);
  fakeClerk.addOrg(clerkOrgId, name, [{ userId: surgeon, firstName: "Jo", lastName: "Seated", role: "org:member" }]);
  const clinic = await prisma.clinic.create({
    data: {
      name,
      clerkOrgId,
      status: data.status ?? "ACTIVE",
      categories: data.categories ?? ["KNEE"],
      showPlaceholders: data.showPlaceholders ?? true,
      surgeonSeats: 5,
      seatAllocations: { create: { clerkUserId: surgeon, syncState: "SYNCED" } },
    },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

beforeAll(async () => {
  fakeClerk.reset();
  kneeClinic = await makeClinic("Vitest send clinic (knee)", orgKnee, {});
  fakeClerk.addMember(orgKnee, { userId: noSeat, firstName: "No", lastName: "Seat", role: "org:member" });
  hipClinic = await makeClinic("Vitest send clinic (hip)", orgHip, { categories: ["HIP"] });
  finishedOnlyClinic = await makeClinic("Vitest send clinic (finished only)", orgFinishedOnly, { showPlaceholders: false });
  await makeClinic("Vitest send clinic (pending)", orgPending, { status: "PENDING" });

  const placeholder = await prisma.video.create({
    data: { title: "Vitest send video", category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true, isPlaceholder: true },
    select: { id: true },
  });
  const unpublished = await prisma.video.create({
    data: { title: "Vitest send video (unpublished)", category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: false },
    select: { id: true },
  });
  createdVideoIds.push(placeholder.id, unpublished.id);
  placeholderId = placeholder.id;
  unpublishedId = unpublished.id;
});

beforeEach(() => {
  vi.resetAllMocks();
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  fakeClerk.reset();
  await prisma.$disconnect();
});

async function linksFor(clinicId: string) {
  return prisma.share.count({ where: { clinicId } });
}

describe("sendShareAction", () => {
  it("makes the link for someone holding a seat at an open clinic with the category on its plan, in that clinic, from them", async () => {
    signInAs(orgKnee);
    const result = await sendShareAction(placeholderId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.link).toBe(`http://localhost:3000/watch/${result.code}`);
    expect(result.qrImage.startsWith("data:image/svg+xml")).toBe(true);
    expect(result.daysAfterFirstPlay).toBeGreaterThan(0);
    expect(new Date(result.unclaimedUntil).getTime()).toBeGreaterThan(Date.now());
    expect(result.senderName).toBe("Dr. Jo Seated");

    // From the signed-in surgeon automatically: the action takes nothing but a video id.
    const share = await prisma.share.findUnique({ where: { code: result.code }, select: { clinicId: true, videoId: true, senderUserId: true, senderName: true } });
    expect(share).toEqual({ clinicId: kneeClinic, videoId: placeholderId, senderUserId: surgeonOf.get(orgKnee), senderName: "Dr. Jo Seated" });
  });

  it("refuses someone in the clinic who holds no seat, in plain words, and writes nothing", async () => {
    signInAs(orgKnee, noSeat);
    const before = await linksFor(kneeClinic);
    const result = await sendShareAction(placeholderId);
    expect(result).toEqual({
      ok: false,
      error: "Sending links to patients needs a surgeon seat, and you do not hold one right now. Ask your clinic's office admin.",
    });
    expect(await linksFor(kneeClinic)).toBe(before);
  });

  it("refuses someone whose seat was let go after the page was drawn, and writes nothing", async () => {
    const surgeon = surgeonOf.get(orgKnee)!;
    signInAs(orgKnee);
    const before = await linksFor(kneeClinic);
    await prisma.seatAllocation.delete({ where: { clinicId_clerkUserId: { clinicId: kneeClinic, clerkUserId: surgeon } } });
    try {
      expect(await sendShareAction(placeholderId)).toMatchObject({ ok: false, error: expect.stringContaining("needs a surgeon seat") });
      expect(await linksFor(kneeClinic)).toBe(before);
    } finally {
      await prisma.seatAllocation.create({ data: { clinicId: kneeClinic, clerkUserId: surgeon, syncState: "SYNCED" } });
    }
  });

  it("refuses the same video for a clinic whose plan does not include Knee, with a plain message, and writes nothing", async () => {
    signInAs(orgHip);
    const before = await linksFor(hipClinic);

    const result = await sendShareAction(placeholderId);

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("plan") });
    if (!result.ok) expect(result.error).not.toMatch(/error|invalid|403/i);
    expect(await linksFor(hipClinic)).toBe(before);
  });

  it("refuses a placeholder for a clinic shown finished animations only, and writes nothing", async () => {
    signInAs(orgFinishedOnly);
    const result = await sendShareAction(placeholderId);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("placeholder") });
    expect(await linksFor(finishedOnlyClinic)).toBe(0);
  });

  it("refuses a clinic that is not open, before looking at the video", async () => {
    signInAs(orgPending);
    expect(await sendShareAction(placeholderId)).toMatchObject({ ok: false, error: expect.stringContaining("can't send") });
    expect(await prisma.share.count({ where: { clinic: { clerkOrgId: orgPending } } })).toBe(0);
  });

  it("refuses an unpublished video, a video that does not exist, and an empty request", async () => {
    signInAs(orgKnee);
    expect(await sendShareAction(unpublishedId)).toMatchObject({ ok: false, error: expect.stringContaining("not published") });
    expect(await sendShareAction("video_that_does_not_exist")).toMatchObject({ ok: false, error: expect.stringContaining("no longer exists") });
    expect(await sendShareAction("   ")).toEqual({ ok: false, error: "No video was selected." });
  });

  it("refuses a signed-out request", async () => {
    signInAs(null);
    expect(await sendShareAction(placeholderId)).toMatchObject({ ok: false, error: expect.any(String) });
  });
});

describe("when making the link fails for a reason the person can do nothing about", () => {
  // Real sentences a database has produced, the first one on a surgeon's screen in September 2026.
  const TECHNICAL = [
    "Invalid `prisma.$executeRaw()` invocation: Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms",
    "Can't reach database server at `ep-made-up-123.us-east-2.aws.neon.tech:5432`",
  ];
  const TECHNICAL_WORDS = /prisma|invocation|transaction|database|server at|neon|\.tech|timeout|\bms\b|P\d{4}|undefined|exception|stack/i;

  it("shows one plain sentence, keeps the detail for the server log, and writes nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const detail of TECHNICAL) {
        signInAs(orgKnee);
        const before = await prisma.share.count({ where: { clinicId: kneeClinic } });
        const failure = new Error(detail);
        vi.mocked(createShare).mockRejectedValueOnce(failure);

        const result = await sendShareAction(placeholderId);

        expect(result).toEqual({ ok: false, error: "The link could not be made just now. Nothing was sent to anyone. Try again in a moment." });
        if (!result.ok) expect(result.error).not.toMatch(TECHNICAL_WORDS);
        // The server log gets the kind of error only, never the error itself,
        // whose message and stack could hold a share code.
        expect(log).toHaveBeenLastCalledWith("Making a share link from the library failed", "Error");
        expect(log.mock.lastCall!.join(" ")).not.toMatch(TECHNICAL_WORDS);
        expect(await prisma.share.count({ where: { clinicId: kneeClinic } })).toBe(before);
      }
    } finally {
      log.mockRestore();
    }
  });

  it("does the same when finding the clinic is what failed, and for a failure that is not an Error at all", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      signInAs(orgKnee);
      vi.mocked(getCurrentClinicId).mockRejectedValueOnce(new Error(TECHNICAL[1]));
      const first = await sendShareAction(placeholderId);
      expect(first).toMatchObject({ ok: false, error: expect.stringContaining("could not be made just now") });
      if (!first.ok) expect(first.error).not.toMatch(TECHNICAL_WORDS);

      signInAs(orgKnee);
      vi.mocked(createShare).mockRejectedValueOnce("a bare string thrown by something");
      const second = await sendShareAction(placeholderId);
      expect(second).toMatchObject({ ok: false, error: expect.stringContaining("could not be made just now") });
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });

  it("still shows the two kinds of no that are written for a person, word for word", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Out-of-range day settings: a sentence that tells the person who to ask.
      signInAs(orgKnee);
      vi.mocked(createShare).mockRejectedValueOnce(new ShareTermsError("days a link works after the first play"));
      const terms = await sendShareAction(placeholderId);
      expect(terms).toMatchObject({ ok: false, error: expect.stringContaining("Ask Pulse 3D") });

      // A refusal from the access rule (covered fully above): unchanged by this work.
      signInAs(orgHip);
      expect(await sendShareAction(placeholderId)).toMatchObject({ ok: false, error: expect.stringContaining("plan") });

      // Neither is a fault of ours, so neither is logged as one.
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("works again on the very next tap", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      signInAs(orgKnee);
      vi.mocked(createShare).mockRejectedValueOnce(new Error(TECHNICAL[0]));
      expect(await sendShareAction(placeholderId)).toMatchObject({ ok: false });

      signInAs(orgKnee);
      const again = await sendShareAction(placeholderId);
      expect(again).toMatchObject({ ok: true, link: expect.stringContaining("/watch/") });
    } finally {
      log.mockRestore();
    }
  });
});

describe("setMyPatientNameAction: a surgeon sets their own name for patients", () => {
  const seatName = (clinicId: string, clerkUserId: string) =>
    prisma.seatAllocation.findUnique({ where: { clinicId_clerkUserId: { clinicId, clerkUserId } }, select: { displayName: true } });
  const putBack = (clinicId: string, clerkUserId: string) =>
    prisma.seatAllocation.update({ where: { clinicId_clerkUserId: { clinicId, clerkUserId } }, data: { displayName: null } });

  it("saves the signed-in surgeon's own name and credential, logs it as theirs, and the next link carries it", async () => {
    const surgeon = surgeonOf.get(orgKnee)!;
    signInAs(orgKnee);
    try {
      expect(await setMyPatientNameAction({ name: "Jo Seated", credential: "DO" })).toEqual({
        message: `Saved. Links you send from now on show "Dr. Jo Seated, DO".`,
        name: "Dr. Jo Seated, DO",
      });
      expect(await seatName(kneeClinic, surgeon)).toEqual({ displayName: "Dr. Jo Seated, DO" });
      const note = await prisma.clinicNote.findFirst({ where: { clinicId: kneeClinic }, orderBy: { createdAt: "desc" }, select: { authorName: true, body: true } });
      expect(note).toEqual({
        authorName: "Jo Seated (surgeon)",
        body: `Name patients see for Jo Seated changed from the default, "Dr. Jo Seated" to "Dr. Jo Seated, DO". Links already sent keep the old name.`,
      });

      const sent = await sendShareAction(placeholderId);
      expect(sent).toMatchObject({ ok: true, senderName: "Dr. Jo Seated, DO" });
    } finally {
      await putBack(kneeClinic, surgeon);
    }
  });

  it("changes only their own name, even with someone else's id slipped into what was sent", async () => {
    const surgeon = surgeonOf.get(orgKnee)!;
    const colleague = `user_colleague${randomBytes(6).toString("hex")}`;
    fakeClerk.addMember(orgKnee, { userId: colleague, firstName: "Cole", lastName: "League", role: "org:member" });
    await prisma.seatAllocation.create({ data: { clinicId: kneeClinic, clerkUserId: colleague, syncState: "SYNCED" } });
    signInAs(orgKnee);
    try {
      const forged = { name: "Not Me", credential: "NP", userId: colleague, targetUserId: colleague, clinicId: hipClinic };
      expect(await setMyPatientNameAction(forged)).toMatchObject({ name: "Not Me, NP" });
      expect(await seatName(kneeClinic, surgeon)).toEqual({ displayName: "Not Me, NP" });
      expect(await seatName(kneeClinic, colleague)).toEqual({ displayName: null });
    } finally {
      await putBack(kneeClinic, surgeon);
      await prisma.seatAllocation.delete({ where: { clinicId_clerkUserId: { clinicId: kneeClinic, clerkUserId: colleague } } });
    }
  });

  it("refuses someone with no seat, a signed-out visitor and a clinic that is not open, and a bad name, writing nothing", async () => {
    const notesBefore = await prisma.clinicNote.count({ where: { clinicId: kneeClinic } });

    signInAs(orgKnee, noSeat);
    expect(await setMyPatientNameAction({ name: "No Seat", credential: "MD" })).toEqual({
      error: "Only people holding a seat send links, and you do not hold one right now. Ask your clinic's office admin.",
    });

    signInAs(null);
    expect(await setMyPatientNameAction({ name: "Jo Seated", credential: "MD" })).toEqual({
      error: "Your name can't be changed right now. Sign in again, or ask your clinic's office admin.",
    });
    signInAs(orgPending);
    expect(await setMyPatientNameAction({ name: "Jo Seated", credential: "MD" })).toMatchObject({ error: expect.stringContaining("can't be changed") });

    signInAs(orgKnee);
    expect(await setMyPatientNameAction({ name: "Dr. Jo Seated", credential: "MD" })).toMatchObject({ error: expect.stringContaining('Leave "Dr." out') });
    expect(await setMyPatientNameAction("Dr. Jo Seated, MD")).toEqual({ error: "Type the name and choose a credential." });

    expect(await seatName(kneeClinic, surgeonOf.get(orgKnee)!)).toEqual({ displayName: null });
    expect(await prisma.clinicNote.count({ where: { clinicId: kneeClinic } })).toBe(notesBefore);
  });

  it("answers a failure with a plain sentence, and logs only the kind", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      signInAs(orgKnee);
      vi.mocked(getCurrentClinicId).mockRejectedValueOnce(new Error(`postgres://user:secret@host/db`));
      expect(await setMyPatientNameAction({ name: "Jo Seated", credential: "MD" })).toEqual({
        error: "That could not be saved just now. Nothing was changed. Try again in a moment.",
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    } finally {
      log.mockRestore();
    }
  });
});

describe("refreshPlaybackAction", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const MUX_ENV = { MUX_SIGNING_KEY_ID: "testkey0001", MUX_SIGNING_PRIVATE_KEY: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }).toString()).toString("base64") };
  let muxKneeId = "";

  beforeAll(async () => {
    const video = await prisma.video.create({
      data: { title: "Vitest send video (Mux)", category: "KNEE", videoUrl: "https://example.com/vitest-cdn-copy.mp4", isPublished: true, muxPlaybackId: `Vitest${randomBytes(6).toString("hex")}` },
      select: { id: true },
    });
    createdVideoIds.push(video.id);
    muxKneeId = video.id;
    Object.assign(process.env, MUX_ENV);
  });

  afterAll(() => {
    delete process.env.MUX_SIGNING_KEY_ID;
    delete process.env.MUX_SIGNING_PRIVATE_KEY;
  });

  it("hands anyone in an open clinic whose plan has the category a fresh signed address, seat or no seat, and the plain file for a CDN video", async () => {
    signInAs(orgKnee, noSeat);
    const answer = await refreshPlaybackAction(muxKneeId);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.source.kind).toBe("stream");
    expect(JSON.stringify(answer.source)).not.toContain("example.com");

    signInAs(orgKnee);
    expect(await refreshPlaybackAction(placeholderId)).toEqual({ ok: true, source: { kind: "file", src: "https://example.com/vitest.mp4" } });
  });

  it("hands nothing to a clinic whose plan lacks the category, a clinic that has not paid, someone signed out, or for an unpublished or made-up video", async () => {
    signInAs(orgHip);
    expect(await refreshPlaybackAction(muxKneeId)).toEqual({ ok: false, reason: "ended" });
    signInAs(orgPending);
    expect(await refreshPlaybackAction(muxKneeId)).toEqual({ ok: false, reason: "ended" });
    signInAs(null);
    expect(await refreshPlaybackAction(muxKneeId)).toEqual({ ok: false, reason: "ended" });
    signInAs(orgKnee);
    expect(await refreshPlaybackAction(unpublishedId)).toEqual({ ok: false, reason: "ended" });
    expect(await refreshPlaybackAction("no-such-video")).toEqual({ ok: false, reason: "ended" });
    expect(await refreshPlaybackAction("")).toEqual({ ok: false, reason: "ended" });
  });

  it("stops renewing the moment the category leaves the plan", async () => {
    signInAs(orgKnee);
    expect((await refreshPlaybackAction(muxKneeId)).ok).toBe(true);
    await prisma.clinic.update({ where: { id: kneeClinic }, data: { categories: [] } });
    try {
      expect(await refreshPlaybackAction(muxKneeId)).toEqual({ ok: false, reason: "ended" });
    } finally {
      await prisma.clinic.update({ where: { id: kneeClinic }, data: { categories: ["KNEE"] } });
    }
  });

  it("answers unavailable, not an exception and never the CDN file, when Mux is not configured or the server fails", async () => {
    signInAs(orgKnee);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.MUX_SIGNING_KEY_ID;
    try {
      expect(await refreshPlaybackAction(muxKneeId)).toEqual({ ok: false, reason: "unavailable" });
    } finally {
      Object.assign(process.env, MUX_ENV);
    }
    vi.mocked(getCurrentClinicId).mockRejectedValueOnce(new Error("the database went away"));
    expect(await refreshPlaybackAction(muxKneeId)).toEqual({ ok: false, reason: "unavailable" });
    expect(log.mock.calls.flat().every((part) => typeof part === "string")).toBe(true);
  });
});
