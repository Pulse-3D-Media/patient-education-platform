import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { createQrCode, retireQrCode } from "@/lib/db/qr-codes";
import { getSettings } from "@/lib/db/settings";
import PrintedCodePage from "./page";

/**
 * A printed QR code's page (/q/<code>) rendered the way a request renders it,
 * with the database real and no Clerk: a patient is never signed in. What
 * these prove:
 *
 *   - a live code draws the same patient page as a link: the surgeon, the
 *     clinic, the procedure, one Play button, the education line;
 *   - opening it makes no link, and the page carries no patient link;
 *   - a retired code, a code nobody has, a closed clinic and a category off
 *     the plan each get a calm page with no Play button, never a reason a
 *     patient cannot act on, and never the words "error" or "invalid";
 *   - a surgeon who lost their seat is not named; the clinic is.
 *
 * Whether the tap really starts the video and changes the address is a
 * browser check (and a phone check).
 */

// The player imports the play count, a Server Action; rendering never calls it.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/headers", () => ({ headers: async () => new Map([["host", "localhost:3000"]]) }));

const tag = () => randomBytes(5).toString("hex");
const createdClinicIds: string[] = [];
let video = "";

async function setUp(extra: { status?: "ACTIVE" | "PAUSED"; categories?: ("KNEE" | "HIP")[] } = {}) {
  const surgeon = `user_qrpage${tag()}`;
  const clinic = await prisma.clinic.create({
    data: {
      name: `Vitest Summit Orthopedics ${tag()}`,
      status: "ACTIVE",
      categories: ["KNEE"],
      phone: "8015550123",
      seatAllocations: { create: { clerkUserId: surgeon, syncState: "SYNCED", displayName: "Dr. Jane Smith, DO" } },
    },
    select: { id: true, name: true },
  });
  createdClinicIds.push(clinic.id);
  const made = await createQrCode(clinic.id, video, { clerkUserId: surgeon, fallbackName: null }, "Vitest");
  const code = (await prisma.qrCode.findUniqueOrThrow({ where: { id: made.id }, select: { code: true } })).code;
  if (extra.status || extra.categories) {
    await prisma.clinic.update({ where: { id: clinic.id }, data: { status: extra.status, categories: extra.categories } });
  }
  return { clinic, surgeon, id: made.id, code };
}

async function render(code: string) {
  return renderToStaticMarkup(await PrintedCodePage({ params: Promise.resolve({ code }) } as never));
}

beforeAll(async () => {
  video = (
    await prisma.video.create({
      data: { title: "Vitest Total Knee Replacement", category: "KNEE", videoUrl: "https://example.com/vitest.mp4", durationSeconds: 110, isPublished: true },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: video }] } });
  await prisma.qrCode.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: video }] } });
  await prisma.video.deleteMany({ where: { id: video } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

/** The calm-page rules: no Play button and no box, nothing alarming. */
function expectCalm(html: string) {
  expect(html).not.toContain("Tick the box above to play");
  expect(html).not.toContain('type="checkbox"');
  expect(html.toLowerCase()).not.toMatch(/error|invalid|403|404/);
}

describe("a live printed code", () => {
  it("draws the patient page: the surgeon, the clinic, the procedure, the box unticked and Play not ready, and makes no link", async () => {
    const { clinic, code } = await setUp();
    const html = await render(code);
    expect(html).toContain("Dr. Jane Smith, DO");
    expect(html).toContain(clinic.name);
    expect(html).toContain("Vitest Total Knee Replacement");
    expect(html).toContain("I understand this video is for education only.");
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).not.toMatch(/<input[^>]*checked/);
    expect(html).toContain("Tick the box above to play");
    expect(html).toMatch(/<button[^>]*aria-disabled="true"/);
    // The box is the page's one "for education only" statement: the old sentence under the video is gone.
    expect(html).not.toContain("This video is for education only.");
    // No playable address before the tick: the video comes from /q/<code>/accept.
    expect(html).not.toContain("https://example.com/vitest.mp4");
    expect(html).not.toMatch(/<video[^>]*\ssrc=/);
    // No patient link exists yet, and none is in the page.
    expect(html).not.toContain("/watch/");
    expect(await prisma.share.count({ where: { clinicId: clinic.id } })).toBe(0);
  });

  it("names only the clinic once the surgeon holds no seat", async () => {
    const { clinic, surgeon, code } = await setUp();
    await prisma.seatAllocation.deleteMany({ where: { clinicId: clinic.id, clerkUserId: surgeon } });
    const html = await render(code);
    expect(html).not.toContain("Dr. Jane Smith");
    expect(html).toContain(`From ${clinic.name}`);
    expect(html).toContain("Tick the box above to play");
  });
});

describe("when the link stops working (decided 2026-10-08)", () => {
  it("says what the link the Play tap will make carries: the clinic's own number of days when it has one", async () => {
    const { clinic, code } = await setUp();
    await prisma.clinic.update({ where: { id: clinic.id }, data: { viewDaysOverride: 12 } });
    const html = await render(code);
    expect(html).toContain("Once you start watching, this link works for 12 days.");
    expect(html).not.toContain("This link works until");
    expect(html).not.toContain("as many times as you like");
  });

  it("else the platform's number, the same one a new link would be given", async () => {
    const { code } = await setUp();
    const days = (await getSettings()).viewDays;
    expect(await render(code)).toContain(`Once you start watching, this link works for ${days} ${days === 1 ? "day" : "days"}.`);
  });

  it("leaves the line out, and still draws the page, when the number cannot be used as days (no link could be made either)", async () => {
    const { clinic, code } = await setUp();
    await prisma.clinic.update({ where: { id: clinic.id }, data: { viewDaysOverride: 400 } });
    const html = await render(code);
    expect(html).not.toContain("Once you start watching");
    expect(html).toContain("Tick the box above to play");
  });

  it("is not on a page that cannot play", async () => {
    const { clinic, id, code } = await setUp();
    await retireQrCode(clinic.id, id, "Vitest");
    expect(await render(code)).not.toContain("Once you start watching");
  });
});

describe("a printed code that cannot play", () => {
  it("retired: a calm page that says so, with the office's number", async () => {
    const { clinic, id, code } = await setUp();
    await retireQrCode(clinic.id, id, "Vitest");
    const html = await render(code);
    expect(html).toContain("This code is no longer in use");
    expect(html).toContain("tel:");
    expectCalm(html);
  });

  it("a clinic that is closed, or a category off its plan: 'not available right now', and nothing about why", async () => {
    for (const extra of [{ status: "PAUSED" as const }, { categories: ["HIP" as const] }]) {
      const { code } = await setUp(extra);
      const html = await render(code);
      expect(html).toContain("This video isn&#x27;t available right now");
      expect(html.toLowerCase()).not.toMatch(/plan|billing|paused/);
      expectCalm(html);
    }
  });

  it("a code nobody has, or something not shaped like one: 'we couldn't find this code'", async () => {
    for (const code of ["a".repeat(25), "nope", "<script>"]) {
      const html = await render(code);
      expect(html).toContain("We couldn&#x27;t find this code");
      expectCalm(html);
    }
  });
});
