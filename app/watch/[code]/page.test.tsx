import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { getSettings } from "@/lib/db/settings";
import WatchPage from "./page";

/**
 * The patient page rendered on the server, the way a request renders it,
 * with the database real. No Clerk anywhere: a patient is never signed in.
 *
 * What these prove about a clinic's branding on the page a patient sees:
 *   - the clinic's colour, font and logo reach the page, and its name is
 *     always written out, logo or no logo;
 *   - a clinic that set nothing gets the Pulse look;
 *   - stored values that are not understood fall back, and never reach the
 *     page's style;
 *   - the tap-to-call button is there when the link cannot be played and
 *     the clinic has a valid number, and only then;
 *   - the placeholder warning is still the first thing on the page;
 *   - nothing internal about the clinic is in the page.
 *
 * What a render cannot prove (the logo failing to load, the video failing,
 * the large view) needs a browser and is checked there.
 */

// The play count is a Server Action the player imports; rendering never calls it.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The "ask my clinic" piece refreshes the page after a tap that did not go through; a render never taps.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
// The request action reads the request's host to build the email's address; a render never asks.
vi.mock("next/headers", () => ({ headers: async () => new Map([["host", "localhost:3000"]]) }));

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let videoId = "";
let placeholderVideoId = "";
let unpublishedVideoId = "";

const LONG_NAME = "The Intermountain Center for Advanced Orthopedic, Spine and Sports Medicine Surgery of Greater Salt Lake";

function code() {
  return `w${randomBytes(4).toString("hex").slice(0, 7)}`;
}

async function makeClinic(data: Partial<Prisma.ClinicCreateInput>) {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest watch clinic ${randomBytes(3).toString("hex")}`, status: "ACTIVE", categories: ["KNEE"], ...data },
    select: { id: true, name: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic;
}

/** A link that works for another month, or one that ran out yesterday. */
async function makeShare(clinicId: string, video: string, expired = false) {
  const share = await prisma.share.create({
    data: { code: code(), clinicId, videoId: video, expiresAt: new Date(Date.now() + (expired ? -1 : 30) * 86_400_000) },
    select: { code: true },
  });
  return share.code;
}

async function render(shareCode: string) {
  return renderToStaticMarkup(await WatchPage({ params: Promise.resolve({ code: shareCode }) } as never));
}

beforeAll(async () => {
  const make = (data: Partial<Prisma.VideoCreateInput>) =>
    prisma.video.create({
      data: { title: "Vitest Total Knee Replacement", category: "KNEE", videoUrl: "https://example.com/vitest.mp4", durationSeconds: 110, isPublished: true, ...data },
      select: { id: true },
    });
  videoId = (await make({})).id;
  placeholderVideoId = (await make({ isPlaceholder: true })).id;
  unpublishedVideoId = (await make({ isPublished: false })).id;
  createdVideoIds.push(videoId, placeholderVideoId, unpublishedVideoId);
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("a clinic with its own branding", () => {
  it("puts the clinic's colour, font and logo on the page, and still writes its name out", async () => {
    const clinic = await makeClinic({ brandColor: "#7a1f2b", brandFont: "merriweather", logoUrl: "https://example.com/summit.png", phone: "8015550123" });
    const html = await render(await makeShare(clinic.id, videoId));

    // The colour, as the variables the page's band and buttons read (a dark red needs no adjusting on the light page; white reads on it).
    expect(html).toContain("--brand-accent:#7a1f2b");
    expect(html).toContain("--brand-on-accent:#ffffff");
    // The font, as the class from app/brand-fonts.ts (the tests' stand-in names it plainly).
    expect(html).toContain("font-merriweather");
    // The logo, loaded by the browser and told not to send the page's address along.
    expect(html).toContain('src="https://example.com/summit.png"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    // The name, as text, whatever happens to the picture.
    expect(html).toContain(`From ${clinic.name}`);
    expect(html).toContain("Vitest Total Knee Replacement");
  });

  it("keeps the logo in a box of fixed size, so a slow or broken picture cannot move the video", async () => {
    const clinic = await makeClinic({ logoUrl: "https://example.com/slow.png" });
    const html = await render(await makeShare(clinic.id, videoId));

    expect(html).toContain("h-11 w-[220px]");
    // The picture starts invisible; only the browser, once it has loaded, shows it.
    expect(html).toMatch(/<img[^>]*src="https:\/\/example\.com\/slow\.png"[^>]*opacity-0/);
  });

  it("adjusts a colour too pale for the light page, so the band and the call button stay visible", async () => {
    const clinic = await makeClinic({ brandColor: "#fff3a0" });
    const html = await render(await makeShare(clinic.id, videoId));

    expect(html).not.toContain("--brand-accent:#fff3a0");
    expect(html).toMatch(/--brand-accent:#[0-9a-f]{6}/);
  });

  it("copes with a very long clinic name: written out in full on the page, which can wrap", async () => {
    const clinic = await makeClinic({ name: LONG_NAME });
    const html = await render(await makeShare(clinic.id, videoId));

    expect(html).toContain(`From ${LONG_NAME}`);
    expect(html).toContain("break-words");
  });
});

describe("a clinic that set nothing", () => {
  it("gets the Pulse look, Inter, and no logo row", async () => {
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, videoId));

    expect(html).toContain("--brand-accent:#1e5668");
    expect(html).not.toMatch(/font-(merriweather|open-sans|source-sans|montserrat|nunito-sans)/);
    expect(html).not.toContain("h-11 w-[220px]");
    expect(html).toContain(`From ${clinic.name}`);
  });
});

describe("stored values that are not understood", () => {
  it("fall back to the Pulse look and never reach the page", async () => {
    const clinic = await makeClinic({
      brandColor: "red;background:url(https://evil.example/x)",
      brandFont: "papyrus",
      logoUrl: "javascript:alert(1)",
      phone: "555-0123",
    });
    const html = await render(await makeShare(clinic.id, videoId, true));

    expect(html).toContain("--brand-accent:#1e5668");
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("papyrus");
    expect(html).not.toContain("javascript:");
    // A number that is not ten digits never becomes a link that dials somewhere.
    expect(html).not.toContain("tel:");
  });
});

describe("the tap-to-call button", () => {
  it("is on the expired page when the clinic has a valid number, with the number written out", async () => {
    const clinic = await makeClinic({ phone: "8015550123", brandColor: "#7a1f2b" });
    const html = await render(await makeShare(clinic.id, videoId, true));

    expect(html).toContain("This link has expired");
    expect(html).toContain('href="tel:+18015550123"');
    expect(html).toContain("Call (801) 555-0123");
    // A real 56px target, in the clinic's colour.
    expect(html).toMatch(/<a[^>]*href="tel:\+18015550123"[^>]*min-h-14[^>]*bg-brand/);
    expect(html).toContain("--brand-accent:#7a1f2b");
  });

  it("is on the taken-down page too", async () => {
    const clinic = await makeClinic({ phone: "8015550123" });
    const html = await render(await makeShare(clinic.id, unpublishedVideoId));

    expect(html).toContain("This video isn&#x27;t available right now");
    expect(html).toContain('href="tel:+18015550123"');
  });

  it("is not there when the clinic has no number, and the page still says what to do", async () => {
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, videoId, true));

    expect(html).not.toContain("tel:");
    expect(html).toContain("Call the office and ask for your Vitest Total Knee Replacement video.");
  });

  it("is not on the page for a link that does not exist: there is no clinic to call", async () => {
    const html = await render("nosuchcode");

    expect(html).toContain("We couldn&#x27;t find this link");
    expect(html).not.toContain("tel:");
    expect(html).toContain("--brand-accent:#1e5668");
  });

  it("is offered on a working link only if the video fails, so it is not in the page a patient first sees", async () => {
    const clinic = await makeClinic({ phone: "8015550123" });
    const html = await render(await makeShare(clinic.id, videoId));

    expect(html).not.toContain("tel:");
  });
});

describe("what stays the same", () => {
  it("a placeholder link still says so before anything else on the page", async () => {
    const clinic = await makeClinic({ brandColor: "#7a1f2b", logoUrl: "https://example.com/summit.png" });
    const html = await render(await makeShare(clinic.id, placeholderVideoId));

    expect(html).toContain("This plays a sample animation, not this procedure.");
    expect(html.indexOf("Placeholder.")).toBeLessThan(html.indexOf("From "));
    expect(html.indexOf("Placeholder.")).toBeLessThan(html.indexOf("summit.png"));
  });

  it("before the first tap there is one thing to press, Play, with the clinic's mark hidden from screen readers", async () => {
    const clinic = await makeClinic({ logoUrl: "https://example.com/summit.png" });
    const html = await render(await makeShare(clinic.id, videoId));

    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Play Vitest Total Knee Replacement"');
    expect(html).not.toContain("Make the video bigger");
    // The video keeps playsinline and the browser's own controls are never stripped beyond "no download".
    expect(html).toMatch(/<video[^>]*playsInline/);
    expect(html).toContain('controlsList="nodownload"');
    // The mark over the picture is decoration: the name is already on the page as text.
    expect(html).toMatch(/<div aria-hidden="true" class="pointer-events-none absolute/);
  });

  it("nothing internal about the clinic is in the page", async () => {
    const clinic = await makeClinic({ noticeText: "INTERNAL-NOTICE", statusReason: "INTERNAL-REASON", notes: "INTERNAL-NOTES" });
    const html = await render(await makeShare(clinic.id, videoId));

    expect(html).not.toContain("INTERNAL-");
    expect(html).not.toContain(clinic.id);
  });
});

describe("who sent the link", () => {
  it("says 'Sent by' the surgeon and the clinic near the top, for a link that carries a name", async () => {
    const clinic = await makeClinic({ name: "Vitest Summit Orthopedics" });
    const share = await prisma.share.create({
      data: {
        code: code(),
        clinicId: clinic.id,
        videoId,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        senderUserId: "user_vitestsender",
        senderName: "Dr. Jane Smith",
      },
      select: { code: true },
    });
    const html = await render(share.code);
    expect(html).toContain("Sent by Dr. Jane Smith, Vitest Summit Orthopedics");
    // It comes before the procedure's name, as "who sent me this" always has.
    expect(html.indexOf("Sent by Dr. Jane Smith")).toBeLessThan(html.indexOf("Vitest Total Knee Replacement"));
    // The surgeon's account id is never in the page.
    expect(html).not.toContain("user_vitestsender");
  });

  it("keeps the older wording for a link made before surgeons were recorded", async () => {
    const clinic = await makeClinic({ name: "Vitest Older Orthopedics" });
    const html = await render(await makeShare(clinic.id, videoId));
    expect(html).toContain("From Vitest Older Orthopedics");
    expect(html).not.toContain("Sent by");
  });
});

describe("a link that has paused", () => {
  const DAY = 86_400_000;
  let maxRenewals = 0;

  beforeAll(async () => {
    maxRenewals = (await getSettings()).maxRenewals;
    // The testing branch's settings decide the maximum; the paused page needs at least one renewal to exist.
    expect(maxRenewals).toBeGreaterThanOrEqual(1);
  });

  /** A first-play link played 20 days ago with 10 days, so it ran out 10 days ago; `over` changes what kind of link it is. */
  async function makeRanOut(clinicId: string, video: string, over: Partial<Prisma.ShareUncheckedCreateInput> = {}) {
    const share = await prisma.share.create({
      data: {
        code: code(),
        clinicId,
        videoId: video,
        expiryPolicy: "FIRST_PLAY",
        firstPlayedAt: new Date(Date.now() - 20 * DAY),
        daysAfterFirstPlay: 10,
        expiresAt: new Date(Date.now() - 10 * DAY),
        viewCount: 1,
        ...over,
      },
      select: { code: true },
    });
    return share.code;
  }

  it("shows one button, Ask my clinic, and nothing to type into: no box, no form, no field of any kind", async () => {
    const clinic = await makeClinic({ phone: "8015550123" });
    const html = await render(await makeRanOut(clinic.id, videoId));

    expect(html).toContain("This link has paused");
    expect(html).toContain("Tap below to ask your clinic to turn it back on.");
    expect(html).toContain("Ask my clinic");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<form");
    // Before the tap the button is the only thing to do: no number to call, no video, and no technical words.
    expect(html).not.toContain("tel:");
    expect(html).not.toContain("<video");
    expect(html).not.toMatch(/expired|error|invalid|renewal/i);
  });

  it("shows the confirmation instead of the button when the clinic was asked within the last day, with the office's number", async () => {
    const clinic = await makeClinic({ phone: "8015550123" });
    const html = await render(await makeRanOut(clinic.id, videoId, { renewalRequestedAt: new Date(Date.now() - 60 * 60 * 1000) }));

    expect(html).toContain("Your clinic has been asked");
    expect(html).toContain("Try this same link again in a day or so.");
    expect(html).not.toContain("Ask my clinic");
    expect(html).not.toContain("<button");
    expect(html).toContain('href="tel:+18015550123"');
  });

  it("offers the button again once a day has passed since the last request", async () => {
    const clinic = await makeClinic({});
    const html = await render(await makeRanOut(clinic.id, videoId, { renewalRequestedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }));
    expect(html).toContain("Ask my clinic");
  });

  it("is the calm expired page, with no button, once the renewals are used up", async () => {
    const clinic = await makeClinic({ phone: "8015550123" });
    const html = await render(await makeRanOut(clinic.id, videoId, { renewalsUsed: maxRenewals }));

    expect(html).toContain("This link has expired");
    expect(html).toContain("can send you a fresh one");
    expect(html).not.toContain("Ask my clinic");
    expect(html).not.toContain("<button");
    expect(html).toContain('href="tel:+18015550123"');
  });

  it("never offers the button on a link nobody played, a legacy link, or a paused link whose video is taken down", async () => {
    const clinic = await makeClinic({});

    const neverPlayed = await render(await makeRanOut(clinic.id, videoId, { firstPlayedAt: null, viewCount: 0 }));
    expect(neverPlayed).toContain("This link has expired");
    expect(neverPlayed).not.toContain("Ask my clinic");

    const legacy = await render(await makeShare(clinic.id, videoId, true));
    expect(legacy).toContain("This link has expired");
    expect(legacy).not.toContain("Ask my clinic");

    const takenDown = await render(await makeRanOut(clinic.id, unpublishedVideoId));
    expect(takenDown).toContain("This link has expired");
    expect(takenDown).not.toContain("Ask my clinic");
  });

  it("wears the clinic's colour and writes nothing internal on the paused page", async () => {
    const clinic = await makeClinic({ brandColor: "#7a1f2b", noticeText: "INTERNAL-NOTICE" });
    const html = await render(await makeRanOut(clinic.id, videoId));
    expect(html).toContain("--brand-accent:#7a1f2b");
    expect(html).not.toContain("INTERNAL-");
    expect(html).not.toContain(clinic.id);
  });
});
