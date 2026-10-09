import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { DISCLAIMER } from "@/lib/education-note";

/**
 * POST /watch/<code>/accept, against the testing database: the patient ticked
 * the "for education only" box on a patient link's page. What these prove:
 *
 *   - each call records one tick on the link, and only then hands out the
 *     video: the CDN file, or a signed Mux grant bounded by the link;
 *   - an expired, paused, taken-down or unknown link gets nothing written
 *     and no video, with one answer for all of them;
 *   - a malformed code, a missing or malformed version and junk are refused
 *     before the database is asked; words the server no longer records are a
 *     409, so the page reloads;
 *   - nothing is ever cached or indexed, there is no GET, and the log never
 *     holds the code.
 */

vi.mock("@/lib/db/shares", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/shares")>();
  return { ...actual, acceptShareDisclaimer: vi.fn(actual.acceptShareDisclaimer) };
});

const { acceptShareDisclaimer, createShare, recordSharePlay } = await import("@/lib/db/shares");
const route = await import("./route");

const V = DISCLAIMER.version;
const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let clinic = "";
let fileVideo = "";
let muxVideo = "";

function post(code: string, body: unknown) {
  const request = new Request(`http://localhost/watch/${code}/accept`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
  return route.POST(request, { params: Promise.resolve({ code }) } as never);
}

async function record(code: string) {
  return prisma.share.findUniqueOrThrow({ where: { code }, select: { disclaimerAcceptances: true, disclaimerFirstAcceptedAt: true, disclaimerVersion: true, viewCount: true } });
}

beforeAll(async () => {
  const row = await prisma.clinic.create({
    data: { name: `Vitest accept route clinic ${randomBytes(4).toString("hex")}`, status: "ACTIVE", categories: ["KNEE"] },
    select: { id: true },
  });
  clinic = row.id;
  createdClinicIds.push(clinic);
  const file = await prisma.video.create({
    data: { title: "Vitest accept file video", category: "KNEE", videoUrl: "https://example.com/vitest-accept.mp4", durationSeconds: 110, isPublished: true },
    select: { id: true },
  });
  const mux = await prisma.video.create({
    data: { title: "Vitest accept Mux video", category: "KNEE", videoUrl: null, muxPlaybackId: `VitestAccept${randomBytes(6).toString("hex")}`, durationSeconds: 110, isPublished: true },
    select: { id: true },
  });
  fileVideo = file.id;
  muxVideo = mux.id;
  createdVideoIds.push(file.id, mux.id);
});

afterEach(() => {
  vi.mocked(acceptShareDisclaimer).mockClear();
  delete process.env.MUX_SIGNING_KEY_ID;
  delete process.env.MUX_SIGNING_PRIVATE_KEY;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("POST /watch/<code>/accept", () => {
  it("records the tick, then hands out the file, never cached and never indexed", async () => {
    const { code } = await createShare(clinic, fileVideo);
    const response = await post(code, { version: V });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ source: { kind: "file", src: "https://example.com/vitest-accept.mp4" } });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");

    const row = await record(code);
    expect(row.disclaimerAcceptances).toBe(1);
    expect(row.disclaimerFirstAcceptedAt).not.toBeNull();
    expect(row.disclaimerVersion).toBe(V);
    // A tick is not a play.
    expect(row.viewCount).toBe(0);
  });

  it("records once per call: three calls are three ticks, with the first time kept", async () => {
    const { code } = await createShare(clinic, fileVideo);
    await post(code, { version: V });
    const first = (await record(code)).disclaimerFirstAcceptedAt;
    await post(code, { version: V });
    await post(code, { version: V });
    const row = await record(code);
    expect(row.disclaimerAcceptances).toBe(3);
    expect(row.disclaimerFirstAcceptedAt).toEqual(first);
  });

  it("hands out a signed Mux grant, bounded by the link, for a video that has moved to Mux", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.MUX_SIGNING_KEY_ID = "testkey0001";
    process.env.MUX_SIGNING_PRIVATE_KEY = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }).toString()).toString("base64");
    const { code } = await createShare(clinic, muxVideo);
    const body = (await (await post(code, { version: V })).json()) as { source: { kind: string; src: string; poster: string; expiresAt: number } };
    expect(body.source.kind).toBe("stream");
    expect(body.source.src).toMatch(/^https:\/\/stream\.mux\.com\/.+\.m3u8\?token=/);
    expect(body.source.expiresAt).toBeGreaterThan(Date.now());
    expect((await record(code)).disclaimerAcceptances).toBe(1);
  });

  it("records the tick and answers 'unavailable' when Mux cannot sign here, so the player shows its calm panel", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { code } = await createShare(clinic, muxVideo);
    expect(await (await post(code, { version: V })).json()).toEqual({ source: { kind: "unavailable" } });
    expect((await record(code)).disclaimerAcceptances).toBe(1);
  });

  it("refuses an expired, paused, taken-down or unknown link with nothing written and no video", async () => {
    const expired = await createShare(clinic, fileVideo);
    await prisma.share.update({ where: { code: expired.code }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const paused = await createShare(clinic, fileVideo, { now: new Date(Date.now() - 30 * 86_400_000) });
    expect((await recordSharePlay(paused.code, new Date(Date.now() - 30 * 86_400_000))).recorded).toBe(true);

    const hiddenVideo = await prisma.video.create({
      data: { title: "Vitest accept hidden video", category: "KNEE", videoUrl: "https://example.com/hidden.mp4", isPublished: true },
      select: { id: true },
    });
    createdVideoIds.push(hiddenVideo.id);
    const hidden = await createShare(clinic, hiddenVideo.id);
    await prisma.video.update({ where: { id: hiddenVideo.id }, data: { isPublished: false } });

    for (const code of [expired.code, paused.code, hidden.code, "zzunknown1"]) {
      const response = await post(code, { version: V });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ source: null });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    for (const code of [expired.code, paused.code, hidden.code]) {
      const row = await record(code);
      expect(row.disclaimerAcceptances).toBe(0);
      expect(row.disclaimerFirstAcceptedAt).toBeNull();
    }
  });

  it("refuses a malformed code or body before the database is asked", async () => {
    const { code } = await createShare(clinic, fileVideo);
    for (const [c, body] of [
      ["has space", { version: V }],
      ["<script>", { version: V }],
      ["x".repeat(21), { version: V }],
      [code, {}],
      [code, { version: "yesterday" }],
      [code, { version: 20261008 }],
      [code, "not json"],
    ] as const) {
      const response = await post(c, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ source: null });
    }
    expect(acceptShareDisclaimer).not.toHaveBeenCalled();
    expect((await record(code)).disclaimerAcceptances).toBe(0);
  });

  it("answers 409 for words the server no longer records, so the page reloads, with nothing written", async () => {
    const { code } = await createShare(clinic, fileVideo);
    const response = await post(code, { version: "2020-01-01" });
    expect(response.status).toBe(409);
    expect(acceptShareDisclaimer).not.toHaveBeenCalled();
    expect((await record(code)).disclaimerAcceptances).toBe(0);
  });

  it("answers a failure with 500 for the page to try again, and logs only the kind", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(acceptShareDisclaimer).mockRejectedValueOnce(new Error("connection to postgres://user:secret@db.example/neondb failed for abc123xyz0"));
    const response = await post("abc123xyz0", { version: V });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ source: null });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("abc123xyz0");
    expect(logged).not.toContain("secret");
  });

  it("has no GET or HEAD: opening the address never records a tick", () => {
    expect(Object.keys(route)).toEqual(["POST"]);
  });
});
