import type { Prisma } from "@prisma/client";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { getSettings } from "@/lib/db/settings";
import { describeLinkDate } from "@/lib/format";
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
// The share button reads the address (usePathname) to know whether there is a link of the patient's own yet.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/watch/vitest" }));
// The request action reads the request's host to build the email's address; a render never asks.
vi.mock("next/headers", () => ({ headers: async () => new Map([["host", "localhost:3000"]]) }));

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let videoId = "";
let placeholderVideoId = "";
let unpublishedVideoId = "";
/** A published video whose length is not known: the page never says "a few minutes" for it, so a deadline's edge can be seen plainly. */
let noLengthVideoId = "";

const LONG_NAME = "The Intermountain Center for Advanced Orthopedic, Spine and Sports Medicine Surgery of Greater Salt Lake";

function code() {
  return `w${randomBytes(5).toString("hex").slice(0, 9)}`;
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

/** The page as a browser that runs scripts sees it: the <noscript> sentence (and the number in it) taken out. */
function withScripts(html: string) {
  return html.replace(/<noscript>[\s\S]*?<\/noscript>/g, "");
}

beforeAll(async () => {
  const make = (data: Partial<Prisma.VideoUncheckedCreateInput>) =>
    prisma.video.create({
      data: { title: "Vitest Total Knee Replacement", category: "KNEE", videoUrl: "https://example.com/vitest.mp4", durationSeconds: 110, isPublished: true, ...data },
      select: { id: true },
    });
  videoId = (await make({})).id;
  placeholderVideoId = (await make({ isPlaceholder: true })).id;
  unpublishedVideoId = (await make({ isPublished: false })).id;
  noLengthVideoId = (await make({ durationSeconds: null })).id;
  createdVideoIds.push(videoId, placeholderVideoId, unpublishedVideoId, noLengthVideoId);
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

    // 36px tall on a phone, 44px from 640px wide.
    expect(html).toContain("h-9 w-[180px] max-w-full sm:h-11 sm:w-[220px]");
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
    expect(html).not.toContain("w-[180px]");
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

  it("answers a code of the wrong shape with the not-found page before anything is looked up", async () => {
    const lookup = vi.spyOn(prisma.share, "findUnique");
    try {
      for (const junk of ["has space", "<script>", "x".repeat(21), "abc'--", "", "short1"]) {
        const html = await render(junk);
        expect(html, junk).toContain("We couldn&#x27;t find this link");
        expect(html, junk).not.toContain("tel:");
      }
      expect(lookup).not.toHaveBeenCalled();

      // The control: a code of the right shape is looked up, once, and is not found.
      expect(await render("nosuchcode")).toContain("We couldn&#x27;t find this link");
      expect(lookup).toHaveBeenCalledOnce();
    } finally {
      lookup.mockRestore();
    }
  });

  it("draws the same not-found page for a short old six-character code, even on a working link, with nothing about the clinic or the video", async () => {
    const clinic = await makeClinic({ phone: "8015550123" });
    const short = randomBytes(3).toString("hex");
    await prisma.share.create({ data: { code: short, clinicId: clinic.id, videoId: videoId, expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
    const html = await render(short);

    expect(html).toContain("We couldn&#x27;t find this link");
    expect(html).not.toContain("tel:");
    expect(html).not.toContain("Vitest Total Knee Replacement");
    expect(html).not.toContain(clinic.name);
  });

  it("is offered on a working link only if the video fails, so it is not in the page a patient first sees", async () => {
    const clinic = await makeClinic({ phone: "8015550123" });
    const html = withScripts(await render(await makeShare(clinic.id, videoId)));

    expect(html).not.toContain("tel:");
    expect(html).not.toContain("Call your clinic:");
  });

  it("is a button on a phone and plain words on a computer, chosen by the browser, so the page is the same for everyone", async () => {
    const clinic = await makeClinic({ phone: "8015550123" });
    const html = await render(await makeShare(clinic.id, videoId, true));

    // The button hides itself on a computer (a mouse or trackpad that can hover: the "computer:" variant in app/globals.css).
    expect(html).toMatch(/<a[^>]*href="tel:\+18015550123"[^>]*computer:hidden/);
    // The number as words, not a link, hidden everywhere else.
    expect(html).toMatch(/<p class="hidden[^"]*computer:flex[^"]*">.*?Call your clinic: <span[^>]*>\(801\) 555-0123<\/span>/);
    expect(html).not.toMatch(/<a[^>]*>[^<]*Call your clinic/);
  });
});

describe("the education line", () => {
  const SENTENCE = "This video is for education only. It is not medical advice. Ask your doctor about anything you are unsure of.";

  it("is no longer under the video: the box above it is the page's one statement (option B, 2026-10-10)", async () => {
    const clinic = await makeClinic({});
    for (const video of [videoId, placeholderVideoId]) {
      const html = await render(await makeShare(clinic.id, video));
      expect(html).not.toContain(SENTENCE);
      expect(html).toContain("I understand this video is for education only.");
      expect(html.toLowerCase()).not.toContain("consent");
    }
  });
});

describe("when the link stops working (decided 2026-10-08)", () => {
  const DAY = 86_400_000;

  /** A link of any kind, written straight to the database the way createShare and the first play leave it. */
  async function makeLink(clinicId: string, data: Partial<Prisma.ShareUncheckedCreateInput>) {
    const share = await prisma.share.create({
      data: { code: code(), clinicId, videoId, expiresAt: new Date(Date.now() + 30 * DAY), ...data },
      select: { code: true, expiresAt: true },
    });
    return share;
  }

  /** The line's own markup: one 16px line in the page's small-text grey, nothing louder. */
  function deadlineLine(html: string) {
    return /<p class="[^"]*"><svg[^>]*>(?:(?!<\/svg>).)*<\/svg><span>(?:Once you start watching|This link works until)[^<]*<\/span><\/p>/.exec(html)?.[0] ?? null;
  }

  it("a first-play link nobody has played: 'Once you start watching, this link works for 10 days.', from the link's own number", async () => {
    const clinic = await makeClinic({});
    for (const days of [10, 3, 1]) {
      const link = await makeLink(clinic.id, { expiryPolicy: "FIRST_PLAY", daysAfterFirstPlay: days, expiresAt: new Date(Date.now() + 90 * DAY) });
      const html = await render(link.code);
      expect(html).toContain(`Once you start watching, this link works for ${days} ${days === 1 ? "day" : "days"}.`);
      expect(html).not.toContain("This link works until");
    }
  });

  it("a played first-play link: 'This link works until <the deadline's date>.', drawn first in Utah time and rewritten by the phone in its own", async () => {
    const clinic = await makeClinic({});
    const link = await makeLink(clinic.id, {
      expiryPolicy: "FIRST_PLAY",
      daysAfterFirstPlay: 10,
      firstPlayedAt: new Date(Date.now() - 2 * DAY),
      expiresAt: new Date(Date.now() + 8 * DAY),
      viewCount: 1,
    });
    const html = await render(link.code);
    expect(html).toContain(`This link works until ${describeLinkDate(link.expiresAt, new Date(), "America/Denver")}.`);
    expect(html).not.toContain("Once you start watching");
  });

  it("a legacy (fixed-date) link, played or not: 'This link works until <its date>.'", async () => {
    const clinic = await makeClinic({});
    for (const viewCount of [0, 4]) {
      const link = await makeLink(clinic.id, { viewCount, expiresAt: new Date(Date.now() + 45 * DAY) });
      const html = await render(link.code);
      expect(html).toContain(`This link works until ${describeLinkDate(link.expiresAt, new Date(), "America/Denver")}.`);
    }
  });

  it("is one quiet line: 15px (16px until 2026-11-17), the small-text grey, under the video's length, never red, never 'expire'", async () => {
    const clinic = await makeClinic({});
    const link = await makeLink(clinic.id, { expiryPolicy: "FIRST_PLAY", daysAfterFirstPlay: 10 });
    const html = await render(link.code);
    const line = deadlineLine(html);
    expect(line).not.toBeNull();
    expect(line).toContain("text-[15px]");
    expect(line).toContain("text-[#46555e]");
    expect(line!.toLowerCase()).not.toMatch(/red|danger|problem|expire/);
    // Under the length line ("About 2 minutes"), not above the video.
    expect(html.indexOf("About 2 minutes")).toBeLessThan(html.indexOf(line!));
    expect(html.indexOf("<video")).toBeLessThan(html.indexOf(line!));
  });

  it("no longer says 'watch it as many times as you like' (Van, 2026-10-08)", async () => {
    const clinic = await makeClinic({});
    const html = await render((await makeLink(clinic.id, {})).code);
    expect(html).not.toContain("as many times as you like");
    expect(html).not.toContain("anyone coming with you");
  });

  it("gives way to 'stops working in a few minutes' when that applies, so the page never says both", async () => {
    const clinic = await makeClinic({});
    // Played, and one minute left on a 110-second video.
    const link = await makeLink(clinic.id, {
      expiryPolicy: "FIRST_PLAY",
      daysAfterFirstPlay: 10,
      firstPlayedAt: new Date(Date.now() - 10 * DAY),
      expiresAt: new Date(Date.now() + 60_000),
      viewCount: 1,
    });
    const html = await render(link.code);
    expect(html).toContain("stops working in a few minutes");
    expect(deadlineLine(html)).toBeNull();
    expect(html).not.toContain("This link works until");
  });

  describe("at the deadline itself", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("a played link: one millisecond before, the 'few minutes' note says it; at the deadline, the link has paused and no date is shown", async () => {
      const clinic = await makeClinic({});
      const deadline = new Date(Date.now() + 3 * DAY);
      const link = await makeLink(clinic.id, {
        expiryPolicy: "FIRST_PLAY",
        daysAfterFirstPlay: 10,
        firstPlayedAt: new Date(deadline.getTime() - 10 * DAY),
        expiresAt: deadline,
        viewCount: 1,
      });

      // Only the page's clock is moved; nothing else is faked.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(deadline.getTime() - 1));
      const before = await render(link.code);
      expect(before).toContain("stops working in a few minutes");
      expect(before).not.toContain("This link works until");

      vi.setSystemTime(deadline);
      const at = await render(link.code);
      expect(at).not.toContain("This link works until");
      expect(at).not.toContain("Once you start watching");
      // The paused page (renewals are left on the testing branch, as the paused tests below require) or, if not, the calm expired one.
      expect(at).toMatch(/This link has paused|This link has expired/);
    });

    it("a legacy link to a video of unknown length (no 'few minutes' note): the date one millisecond before, the calm expired page at it", async () => {
      const clinic = await makeClinic({});
      const deadline = new Date(Date.now() + 3 * DAY);
      const link = await makeLink(clinic.id, { videoId: noLengthVideoId, expiresAt: deadline });

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(deadline.getTime() - 1));
      const before = await render(link.code);
      expect(before).toContain(`This link works until ${describeLinkDate(deadline, new Date(), "America/Denver")}.`);
      expect(before).not.toContain("stops working in a few minutes");

      vi.setSystemTime(deadline);
      const at = await render(link.code);
      expect(at).toContain("This link has expired");
      expect(at).not.toContain("This link works until");
    });

    it("a first-play link nobody played, at its unclaimed deadline: the calm expired page, not 'works for 10 days'", async () => {
      const clinic = await makeClinic({});
      const deadline = new Date(Date.now() + 5 * DAY);
      const link = await makeLink(clinic.id, { expiryPolicy: "FIRST_PLAY", daysAfterFirstPlay: 10, expiresAt: deadline });

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(deadline);
      const html = await render(link.code);
      expect(html).toContain("This link has expired");
      expect(html).not.toContain("Once you start watching");
    });
  });
});

describe("the 'for education only' box before the video", () => {
  const BOX = "I understand this video is for education only. It is not medical advice, and I will ask my doctor about anything I am unsure of.";

  it("is above the video, unticked, large, and never says consent", async () => {
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, videoId));

    expect(html).toContain(BOX);
    expect(html.indexOf(BOX)).toBeLessThan(html.indexOf("<video"));
    const box = /<input[^>]*type="checkbox"[^>]*>/.exec(html)![0];
    // No checked or disabled attribute (the class list mentions "disabled:" for a style, which does not count).
    expect(box).not.toMatch(/\schecked[=\s/>]/);
    expect(box).not.toMatch(/\sdisabled[=\s/>]/);
    // A 28px square in a row at least 48px tall, with the words at the page's 18px body size (one step down from 20px, 2026-11-17).
    expect(box).toContain("h-7 w-7");
    expect(html).toMatch(/<label[^>]*min-h-12[^>]*>/);
    expect(html).toMatch(/<span class="[^"]*\btext-\[18px\][^"]*">I understand this video/);
    expect(html.toLowerCase()).not.toContain("consent");
  });

  it("keeps Play visibly not ready: a plain dimmed circle with the triangle, and why said to a screen reader only", async () => {
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, videoId));

    expect(html).toMatch(/<button[^>]*aria-label="Play Vitest Total Knee Replacement"[^>]*aria-disabled="true"/);
    // The circle: at least 48px to tap (60px), white, dimmed until ready, with no words of its own (Evan, 2026-11-17).
    expect(html).toMatch(/<span data-play-circle="" class="flex h-\[60px\] w-\[60px\] [^"]*rounded-full bg-white[^"]*opacity-75/);
    expect(html).toMatch(/<span id="[^"]*-why" class="sr-only">Tick the box above to play<\/span>/);
    expect(html).not.toContain("Tap to play");
    expect(html).not.toContain("data-play-pill");
  });

  it("keeps the patient page's text one step smaller than before and never under 15px (2026-11-17)", async () => {
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, videoId));
    const sizes = [...html.matchAll(/text-\[(\d+)px\]/g)].map(([, px]) => Number(px));

    expect(sizes.length).toBeGreaterThan(0);
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(15);
    expect(html).toMatch(/<h1 class="[^"]*text-\[24px\][^"]*sm:text-\[27px\]/);
    expect(html).toMatch(/<p class="[^"]*text-\[18px\][^"]*">Your surgeon shared this/);
    expect(html).not.toContain("text-[20px] leading-[1.5]");
  });

  it("puts no playable address in the page: the video comes only from the accept route, after the tick", async () => {
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, videoId));

    expect(html).not.toContain("example.com/vitest.mp4");
    expect(html).not.toMatch(/<video[^>]*\ssrc=/);
    expect(html).not.toContain("stream.mux.com");
  });

  it("opens the connection to the file's host early, with the bare host and never the file's address", async () => {
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, videoId));

    expect(html.match(/<link[^>]*rel="preconnect"[^>]*>/g)).toEqual(['<link rel="preconnect" href="https://example.com"/>']);
    expect(html).not.toContain("vitest.mp4");
  });

  it("shows the poster staff set on the video's box until then, a picture and nothing that plays", async () => {
    const clinic = await makeClinic({});
    const withPoster = await prisma.video.create({
      data: { title: "Vitest Poster Knee", category: "KNEE", videoUrl: "https://example.com/vitest-poster.mp4", posterUrl: "https://example.com/still.jpg", isPublished: true },
      select: { id: true },
    });
    createdVideoIds.push(withPoster.id);
    const html = await render(await makeShare(clinic.id, withPoster.id));

    expect(html).toMatch(/<video[^>]*poster="https:\/\/example\.com\/still\.jpg"/);
    expect(html).not.toContain("vitest-poster.mp4");
  });

  it("is not on a page that cannot play: an expired link has no box", async () => {
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, videoId, true));

    expect(html).not.toContain('type="checkbox"');
  });
});

describe("what stays the same", () => {
  it("a placeholder link still says so before anything else on the page", async () => {
    const clinic = await makeClinic({ brandColor: "#7a1f2b", logoUrl: "https://example.com/summit.png" });
    const html = await render(await makeShare(clinic.id, placeholderVideoId));

    expect(html).toContain("This plays a sample animation, not this procedure.");
    expect(html.indexOf("Placeholder.")).toBeLessThan(html.indexOf("From "));
    expect(html.indexOf("Placeholder.")).toBeLessThan(html.indexOf("summit.png"));
    // The mark is carried into the player too, so full screen (which shows only the player) still says so.
    expect(html).toContain("Placeholder animation");
    expect(html.indexOf("Placeholder animation")).toBeGreaterThan(html.indexOf("video player"));
  });

  it("a finished animation's player carries no placeholder mark", async () => {
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, videoId));
    expect(html).not.toContain("Placeholder animation");
  });

  it("before the first tap there is one thing to press on the video, Play, and the one named exception under it, with the strip's logo and names hidden from screen readers", async () => {
    const clinic = await makeClinic({ logoUrl: "https://example.com/summit.png" });
    const html = await render(await makeShare(clinic.id, videoId));

    // Play, and "Save or share this link" (the one exception, decided on 2026-11-16), and nothing else.
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Play Vitest Total Knee Replacement"');
    expect(html).toContain("Save or share this link");
    expect(html).not.toContain("Make the video bigger");
    // Our Vimeo-style controls arrive with the first play, not before (they are not drawn at all until then).
    expect(html).not.toContain('aria-label="Full screen"');
    expect(html).not.toContain('aria-label="Seek"');
    // The video keeps playsinline and never shows the browser's own controls (ours replace them, Evan, 2026-10-15).
    expect(html).toMatch(/<video[^>]*playsInline/);
    expect(html).not.toMatch(/<video[^>]*\scontrols(?!List)/);
    expect(html).toContain('controlsList="nodownload"');
    // The clinic's mark is decoration: the clinic and the sender are already on the page as text.
    expect(html).toMatch(/data-video-strip="" aria-hidden="true"/);
  });

  it("a video's chapters are never on the patient page (they are for the library only)", async () => {
    const clinic = await makeClinic({});
    const chaptered = await prisma.video.create({
      data: {
        title: "Vitest Total Knee Replacement",
        category: "KNEE",
        videoUrl: "https://example.com/vitest.mp4",
        durationSeconds: 110,
        isPublished: true,
        chapters: [
          { startSeconds: 0, title: "Vitest chapter intro" },
          { startSeconds: 33, title: "Vitest chapter knee" },
        ],
      },
      select: { id: true },
    });
    createdVideoIds.push(chaptered.id);
    const html = await render(await makeShare(clinic.id, chaptered.id));

    expect(html).not.toContain("Vitest chapter");
    expect(html).not.toMatch(/Chapters|data-chapter-mark|data-current-chapter/);
  });

  it("nothing internal about the clinic is in the page", async () => {
    const clinic = await makeClinic({ noticeText: "INTERNAL-NOTICE", statusReason: "INTERNAL-REASON", notes: "INTERNAL-NOTES" });
    const html = await render(await makeShare(clinic.id, videoId));

    expect(html).not.toContain("INTERNAL-");
    expect(html).not.toContain(clinic.id);
  });
});

describe("the clinic and the doctor on the video", () => {
  async function shareFrom(clinicId: string, senderName: string | null, video = videoId) {
    const share = await prisma.share.create({
      data: { code: code(), clinicId, videoId: video, expiresAt: new Date(Date.now() + 30 * 86_400_000), senderUserId: senderName ? "user_vitestsender" : null, senderName },
      select: { code: true },
    });
    return share.code;
  }

  /** The mark's part of the page: from its own element to its end. */
  function stripOf(html: string): string {
    const start = html.indexOf("data-video-strip");
    expect(start).toBeGreaterThan(-1);
    return html.slice(start, html.indexOf("</div>", start));
  }

  it("is on the picture, top left, from before the first play: the logo and the surgeon's name alone (the title is written above the player)", async () => {
    const clinic = await makeClinic({ name: "Vitest Strip Orthopedics", logoUrl: "https://example.com/strip-white.png" });
    const html = await render(await shareFrom(clinic.id, "Dr. Jane Smith, DO"));
    const strip = stripOf(html);

    expect(strip).toContain('src="https://example.com/strip-white.png"');
    expect(strip).toContain(">Dr. Jane Smith, DO<");
    expect(strip).not.toContain(">Vitest Total Knee Replacement<");
    expect(strip).not.toContain("Sent by");
    // Inside the video's 16:9 box, in the box over the picture (picture-fit), after the video itself.
    expect(html).toContain("padding-top:56.25%");
    expect(html).toMatch(/class="picture-area absolute inset-0 bg-black outline-none[ "]/);
    expect(html.indexOf("<video")).toBeLessThan(html.indexOf("data-video-strip"));
    expect(html.indexOf("picture-fit")).toBeLessThan(html.indexOf("data-video-strip"));
    // Before Play in the page's order, so it is there before the first tap.
    expect(html.indexOf("data-video-strip")).toBeLessThan(html.indexOf('aria-label="Play Vitest Total Knee Replacement"'));
  });

  it("with no logo, has the clinic's initials in the round frame", async () => {
    const clinic = await makeClinic({ name: "Vitest Nologo Orthopedics" });
    const strip = stripOf(await render(await shareFrom(clinic.id, "Jane Smith, NP")));

    expect(strip).not.toContain("<img");
    expect(strip).toContain(">VN</span>");
    expect(strip).toContain(">Jane Smith, NP<");
  });

  it("for a link with no sender recorded, has the clinic's name in place of a doctor's", async () => {
    const clinic = await makeClinic({ name: "Vitest Older Strip Orthopedics" });
    const strip = stripOf(await render(await shareFrom(clinic.id, null)));

    expect(strip).toMatch(/class="video-chip [^"]*">Vitest Older Strip Orthopedics</);
    expect(strip).not.toContain("Dr. ");
  });

  it("is on a placeholder link too, under the amber bar that still says so first", async () => {
    const clinic = await makeClinic({ name: "Vitest Sample Orthopedics" });
    const html = await render(await shareFrom(clinic.id, "Dr. Jane Smith, DO", placeholderVideoId));

    expect(stripOf(html)).toContain(">Dr. Jane Smith, DO<");
    expect(html.indexOf("Placeholder.")).toBeLessThan(html.indexOf("data-video-strip"));
  });
});

describe("who sent the link", () => {
  it("names the surgeon near the top, with the clinic on the line under it and no 'Sent by', for a link that carries a name", async () => {
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
    // Two lines; on a phone held sideways one, with a dot between that only shows there.
    expect(html).toContain('<span class="block short-landscape:inline">Dr. Jane Smith</span><span class="block short-landscape:inline"><span aria-hidden="true" class="hidden px-1.5 short-landscape:inline">·</span>Vitest Summit Orthopedics</span>');
    expect(html).not.toContain("Sent by");
    // It comes before the procedure's name, as "who sent me this" always has.
    expect(html.indexOf("Dr. Jane Smith")).toBeLessThan(html.indexOf("Vitest Total Knee Replacement"));
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

describe("a video that has moved to Mux", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const MUX_ENV = { MUX_SIGNING_KEY_ID: "testkey0001", MUX_SIGNING_PRIVATE_KEY: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }).toString()).toString("base64") };
  const playbackId = `Vitest${randomBytes(6).toString("hex")}`;
  let muxVideoId = "";

  beforeAll(async () => {
    const video = await prisma.video.create({
      data: { title: "Vitest Mux Knee Replacement", category: "KNEE", videoUrl: "https://example.com/vitest-cdn-copy.mp4", durationSeconds: 110, isPublished: true, muxPlaybackId: playbackId },
      select: { id: true },
    });
    muxVideoId = video.id;
    createdVideoIds.push(video.id);
  });

  afterEach(() => {
    delete process.env.MUX_SIGNING_KEY_ID;
    delete process.env.MUX_SIGNING_PRIVATE_KEY;
    vi.restoreAllMocks();
  });

  it("plays through a signed Mux address, never the CDN file, with the signed still before the first play", async () => {
    Object.assign(process.env, MUX_ENV);
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, muxVideoId));

    // The stream is put on by the player once the page is awake, so the <video> carries no src; the signed still stands in.
    expect(html).toMatch(/<video[^>]*poster="https:\/\/image\.mux\.com\/[^"]*thumbnail\.jpg\?token=[^"]+"/);
    expect(html).not.toMatch(/<video[^>]*\ssrc=/);
    expect(html).not.toContain("example.com/vitest-cdn-copy.mp4");
    // The strip, the sender lines, the controls setting and the education box survive the player change.
    expect(html).toContain("data-video-strip");
    expect(html).toContain('controlsList="nodownload"');
    expect(html).toContain("I understand this video is for education only.");
    expect(html).not.toMatch(/stops working in a few minutes/);
  });

  it("opens the connections to Mux's hosts early, as bare hosts: no playlist, no token, no CDN copy", async () => {
    Object.assign(process.env, MUX_ENV);
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, muxVideoId));

    expect(html.match(/<link[^>]*rel="preconnect"[^>]*>/g)).toEqual([
      '<link rel="preconnect" href="https://stream.mux.com"/>',
      '<link rel="preconnect" href="https://stream.mux.com" crossorigin="anonymous"/>',
      '<link rel="preconnect" href="https://image.mux.com"/>',
    ]);
    // The playlist and its token come only from the accept route, after the tick.
    expect(html).not.toContain(".m3u8");
    expect(html).not.toContain(`stream.mux.com/${playbackId}`);
    expect(html).not.toContain("example.com");
  });

  it("shows the calm did-not-load panel, and never the CDN file, when Mux is not configured on this deployment", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, muxVideoId));

    expect(html).not.toContain("example.com/vitest-cdn-copy.mp4");
    expect(html).not.toContain("stream.mux.com");
    expect(html).not.toMatch(/\berror\b|invalid|\b403\b/i);
    // The page itself still stands: the title, the sender, the note.
    expect(html).toContain("Vitest Mux Knee Replacement");
    expect(html).toContain(`From ${clinic.name}`);
  });

  it("says, honestly, when a played link has less time left than the video needs", async () => {
    Object.assign(process.env, MUX_ENV);
    const clinic = await makeClinic({});
    const played = await prisma.share.create({
      data: {
        code: code(),
        clinicId: clinic.id,
        videoId: muxVideoId,
        expiryPolicy: "FIRST_PLAY",
        daysAfterFirstPlay: 7,
        firstPlayedAt: new Date(Date.now() - 6 * 86_400_000),
        expiresAt: new Date(Date.now() + 60_000),
      },
      select: { code: true },
    });
    const html = await render(played.code);
    expect(html).toContain("stops working in a few minutes");
    expect(html).toContain(`${clinic.name} can send you a fresh link.`);
    // And the token runs out with the link, not an hour later.
    const token = /poster="https:\/\/image\.mux\.com\/[^"]*thumbnail\.jpg\?token=([^"]+)"/.exec(html)![1];
    const exp = (JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { exp: number }).exp * 1000;
    expect(exp).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(exp).toBeGreaterThan(Date.now());
  });

  it("does not say so for an unplayed first-play link, whose first play adds its days", async () => {
    Object.assign(process.env, MUX_ENV);
    const clinic = await makeClinic({});
    const unplayed = await prisma.share.create({
      data: { code: code(), clinicId: clinic.id, videoId: muxVideoId, expiryPolicy: "FIRST_PLAY", daysAfterFirstPlay: 7, expiresAt: new Date(Date.now() + 60_000) },
      select: { code: true },
    });
    expect(await render(unplayed.code)).not.toContain("stops working in a few minutes");
  });
});

describe("for screen readers, the keyboard and a browser without JavaScript (2026-11-16)", () => {
  it("has the player's one status region on the page from the start, empty, so a change is heard when it comes", async () => {
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, videoId));
    expect(html).toMatch(/<p role="status" class="sr-only" data-player-status=""><\/p>/);
    // No region that would appear already filled: the old "alert" panels are gone from the page a patient first sees.
    expect(html).not.toContain('role="alert"');
  });

  it("says what to do without JavaScript in a <noscript> sentence, calmly, with the clinic's number when it has one", async () => {
    const clinic = await makeClinic({ phone: "8015550123" });
    const html = await render(await makeShare(clinic.id, videoId));
    const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? "";
    expect(noscript).toContain("To play this video, your browser needs JavaScript turned on.");
    expect(noscript).toContain(`call ${clinic.name}`);
    expect(noscript).toContain('href="tel:+18015550123"');
    // The share button needs JavaScript too, so it is hidden there rather than left doing nothing.
    expect(noscript).toContain("[data-needs-script]{display:none}");
    expect(noscript).not.toMatch(/error|invalid/i);
  });

  it("keeps the sentence, with no number, for a clinic that has none", async () => {
    const clinic = await makeClinic({});
    const noscript = (await render(await makeShare(clinic.id, videoId))).match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? "";
    expect(noscript).toContain("your browser needs JavaScript turned on");
    expect(noscript).not.toContain("tel:");
  });

  it("labels the box with the whole fixed sentence, and keeps one heading, the procedure, and the page's main landmark", async () => {
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, videoId));
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>.*?<input[^>]*id="\1"[^>]*type="checkbox".*?I understand this video is for education only\. It is not medical advice, and I will ask my doctor about anything I am unsure of\.<\/span><\/label>/);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html.match(/<h[2-6]/g)).toBeNull();
    expect(html).toContain("<main");
  });
});

describe("Save or share this link (decided on 2026-11-16)", () => {
  it("is on a working link's page, under the video's length and the deadline line, 48px tall, with its words as its label", async () => {
    const clinic = await makeClinic({});
    const html = await render(await makeShare(clinic.id, videoId));
    expect(html).toMatch(/<button type="button" data-share-link="" class="[^"]*min-h-12[^"]*">.*?Save or share this link<\/button>/);
    // Below the player and below "About 2 minutes" and the deadline line, so it never pushes the video down.
    expect(html.indexOf("Save or share this link")).toBeGreaterThan(html.indexOf("About 2 minutes"));
    expect(html.indexOf("This link works until")).toBeGreaterThan(0);
    expect(html.indexOf("Save or share this link")).toBeGreaterThan(html.indexOf("This link works until"));
    expect(html.indexOf("Save or share this link")).toBeGreaterThan(html.indexOf("<video"));
    // No box to type into came with it: the page's only input is still the tick box.
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).not.toContain("<form");
  });

  it("is not on a paused, finished (expired), taken-down or not-found page", async () => {
    const clinic = await makeClinic({ phone: "8015550123" });
    const DAY = 86_400_000;
    const paused = await prisma.share.create({
      data: {
        code: code(),
        clinicId: clinic.id,
        videoId,
        expiryPolicy: "FIRST_PLAY",
        firstPlayedAt: new Date(Date.now() - 20 * DAY),
        daysAfterFirstPlay: 10,
        expiresAt: new Date(Date.now() - 10 * DAY),
        viewCount: 1,
      },
      select: { code: true },
    });
    const pages = [
      await render(paused.code),
      await render(await makeShare(clinic.id, videoId, true)),
      await render(await makeShare(clinic.id, unpublishedVideoId)),
      await render(code()),
    ];
    expect(pages[0]).toContain("This link has paused");
    for (const html of pages) expect(html).not.toContain("Save or share this link");
  });
});
