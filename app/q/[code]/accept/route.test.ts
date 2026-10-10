import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { DISCLAIMER } from "@/lib/education-note";

/**
 * POST /q/<code>/accept, against the testing database: the patient ticked
 * the "for education only" box on a printed QR code's page. What these prove:
 *
 *   - a live code hands out the video, and NOTHING IS WRITTEN: no link and no
 *     record exist until the Play tap (the record goes on the link the issue
 *     route makes; see lib/db/qr-codes.test.ts);
 *   - a retired code, an unknown one, a closed clinic and a category off the
 *     plan get no video, with one answer for all of them;
 *   - a malformed code or body is refused before the database is asked, and
 *     words the server no longer records are a 409;
 *   - nothing is cached or indexed, and there is no GET.
 */

vi.mock("@/lib/db/qr-codes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/qr-codes")>();
  return { ...actual, getQrCodeByCode: vi.fn(actual.getQrCodeByCode) };
});

const { createQrCode, getQrCodeByCode, retireQrCode } = await import("@/lib/db/qr-codes");
const route = await import("./route");

const V = DISCLAIMER.version;
const tag = () => randomBytes(5).toString("hex");
const createdClinicIds: string[] = [];
let video = "";

function post(code: string, body: unknown) {
  const request = new Request(`http://localhost/q/${code}/accept`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
  return route.POST(request, { params: Promise.resolve({ code }) } as never);
}

async function setUp() {
  const surgeon = `user_qraccept${tag()}`;
  const clinic = await prisma.clinic.create({
    data: {
      name: `Vitest QR accept clinic ${tag()}`,
      status: "ACTIVE",
      categories: ["KNEE"],
      seatAllocations: { create: { clerkUserId: surgeon, syncState: "SYNCED" } },
    },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  const made = await createQrCode(clinic.id, video, { clerkUserId: surgeon, fallbackName: null }, "Vitest");
  const code = (await prisma.qrCode.findUniqueOrThrow({ where: { id: made.id }, select: { code: true } })).code;
  return { clinic: clinic.id, id: made.id, code };
}

beforeAll(async () => {
  video = (
    await prisma.video.create({
      data: { title: "Vitest QR accept video", category: "KNEE", videoUrl: "https://example.com/vitest-qr.mp4", durationSeconds: 110, isPublished: true },
      select: { id: true },
    })
  ).id;
});

afterEach(() => {
  vi.mocked(getQrCodeByCode).mockClear();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: video }] } });
  await prisma.qrCode.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: video }] } });
  await prisma.video.deleteMany({ where: { id: video } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("POST /q/<code>/accept", () => {
  it("hands out the video for a live code, writes nothing, and is never cached or indexed", async () => {
    const { clinic, code } = await setUp();
    const response = await post(code, { version: V });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ source: { kind: "file", src: "https://example.com/vitest-qr.mp4" } });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    // No link exists until the Play tap.
    expect(await prisma.share.count({ where: { clinicId: clinic } })).toBe(0);
  });

  it("gives no video for a retired code, a closed clinic or a category off the plan, with one answer for all", async () => {
    const retired = await setUp();
    await retireQrCode(retired.clinic, retired.id, "Vitest");
    const closed = await setUp();
    await prisma.clinic.update({ where: { id: closed.clinic }, data: { status: "PAUSED" } });
    const offPlan = await setUp();
    await prisma.clinic.update({ where: { id: offPlan.clinic }, data: { categories: ["HIP"] } });

    for (const { code } of [retired, closed, offPlan, { code: "a".repeat(25) }]) {
      const response = await post(code, { version: V });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ source: null });
    }
    expect(await prisma.share.count({ where: { clinicId: { in: [retired.clinic, closed.clinic, offPlan.clinic] } } })).toBe(0);
  });

  it("refuses a malformed code or body before the database is asked, and answers 409 for other words", async () => {
    const { code } = await setUp();
    for (const [c, body] of [
      ["short", { version: V }],
      [code.toUpperCase(), { version: V }],
      [code, {}],
      [code, { version: "soon" }],
      [code, "not json"],
    ] as const) {
      expect((await post(c, body)).status).toBe(400);
    }
    expect((await post(code, { version: "2020-01-01" })).status).toBe(409);
    expect(getQrCodeByCode).not.toHaveBeenCalled();
  });

  it("answers a failure with 500 for the page to try again, and never logs the printed code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { code } = await setUp();
    vi.mocked(getQrCodeByCode).mockRejectedValueOnce(new Error(`database down while reading ${code}`));
    const response = await post(code, { version: V });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ source: null });
    expect(JSON.stringify(log.mock.calls)).not.toContain(code);
  });

  it("has no GET or HEAD", () => {
    expect(Object.keys(route)).toEqual(["POST"]);
  });
});
