import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CATEGORIES } from "@/lib/categories";
import { prisma } from "@/lib/db/client";
import { setFavorite } from "@/lib/db/personal-videos";
import { watchPageHref } from "@/lib/library-rows";
import CategoryPage from "../../[category]/page";
import WatchPage from "./page";
import { CategoryAvatar } from "./WatchView";

/**
 * The watch page (/library/watch/<videoId>) rendered on the server the way
 * a request renders it, with Clerk replaced by a stand-in and the database
 * real. What this proves: a video the clinic may use opens with nothing
 * playing (no autoplay, one Play button), with its title, the channel line
 * to its category, Favorite, and Send and Show QR only for someone holding
 * a seat, and "More in <category>" holding only what this clinic may use;
 * and every other video id (off the plan, unpublished, a hidden placeholder,
 * made up, junk) is the not-found page with nothing playable sent.
 *
 * That nothing plays until Play is tapped, the layout at each width, the
 * back arrow and the QR panel are browser checks (screenshots in the pull
 * request).
 */

vi.mock("@clerk/nextjs/server", () => ({
  auth: Object.assign(vi.fn(), { protect: vi.fn() }),
  clerkClient: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <span />,
  SignOutButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/library/watch/x",
  useRouter: () => ({ back: () => {}, push: () => {} }),
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

/** Pretend Clerk says this person is in this organization, as a member. */
function signInAs(orgId: string, orgName: string, userId = "user_vitestwatch") {
  vi.mocked(auth).mockResolvedValue({ userId, orgId, has: () => false } as never);
  vi.mocked(auth.protect).mockResolvedValue(undefined as never);
  vi.mocked(clerkClient).mockResolvedValue({
    organizations: {
      getOrganizationMembershipList: async () => ({
        data: [{ organization: { name: orgName, hasImage: false, imageUrl: "" }, publicMetadata: {}, role: "org:member", publicUserData: { firstName: "Jane", lastName: "Smith" } }],
      }),
    },
  } as never);
}

const tag = randomBytes(4).toString("hex");
const fakeOrg = () => `org_test_${randomBytes(8).toString("hex")}`;
const orgKnee = fakeOrg();
const orgFinishedOnly = fakeOrg();
const orgPending = fakeOrg();
const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let kneeClinic = "";

/** The videos this file makes: three on Knee (one a placeholder), one unpublished on Knee, one on Hip. */
const v = { watched: "", other: "", placeholder: "", unpublished: "", hip: "" };
const src = (name: string) => `https://example.com/vitest-watch-${tag}-${name}.mp4`;
const title = (name: string) => `Vitest watch ${name} ${tag}`;

beforeAll(async () => {
  for (const [orgId, name, status, showPlaceholders] of [
    [orgKnee, "Vitest watch clinic (knee)", "ACTIVE", true],
    [orgFinishedOnly, "Vitest watch clinic (finished only)", "ACTIVE", false],
    [orgPending, "Vitest watch clinic (pending)", "PENDING", true],
  ] as const) {
    const clinic = await prisma.clinic.create({ data: { name, clerkOrgId: orgId, status, categories: ["KNEE"], showPlaceholders }, select: { id: true } });
    createdClinicIds.push(clinic.id);
    if (orgId === orgKnee) kneeClinic = clinic.id;
  }
  const made: [keyof typeof v, object][] = [
    ["watched", { category: "KNEE", durationSeconds: 252 }],
    ["other", { category: "KNEE" }],
    ["placeholder", { category: "KNEE", isPlaceholder: true }],
    ["unpublished", { category: "KNEE", isPublished: false }],
    ["hip", { category: "HIP" }],
  ];
  for (const [key, data] of made) {
    const video = await prisma.video.create({ data: { title: title(key), videoUrl: src(key), isPublished: true, ...data } as never, select: { id: true } });
    v[key] = video.id;
    createdVideoIds.push(video.id);
  }
});

beforeEach(() => {
  vi.resetAllMocks();
});

afterAll(async () => {
  await prisma.personalVideo.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.seatAllocation.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

async function renderWatch(videoId: string) {
  return renderToStaticMarkup(await WatchPage({ params: Promise.resolve({ videoId }) } as never));
}

/** A link with this address and this label, whichever order React writes them in. */
function link(href: string, label: string): RegExp {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`<a(?=[^>]*href="${escape(href)}")(?=[^>]*aria-label="${escape(label)}")`);
}

/** The "More in" column of a rendered watch page. */
function moreColumn(html: string): string {
  return html.slice(html.indexOf('aria-labelledby="more-heading"'));
}

describe("the watch page for a video the clinic may use", () => {
  it("opens paused: the video's file on the element, no autoplay, and one Play button", async () => {
    signInAs(orgKnee, "Vitest watch clinic (knee)");
    const html = await renderWatch(v.watched);

    expect(html).toMatch(new RegExp(`<video[^>]*src="${src("watched").replace(/[.]/g, "\\.")}"`));
    expect(html).not.toMatch(/autoplay/i);
    expect(html).toContain(`aria-label="Play ${title("watched")}"`);
    expect(html).not.toContain('aria-label="Seek"');
  });

  it("has the title, the channel line to its category with the tile image, and the length", async () => {
    signInAs(orgKnee, "Vitest watch clinic (knee)");
    const html = await renderWatch(v.watched);
    const knee = CATEGORIES.find((c) => c.value === "KNEE")!;

    expect(html).toMatch(new RegExp(`<h1[^>]*>${title("watched")}</h1>`));
    expect(html).toMatch(link("/library/knee", "More from Knee"));
    expect(html).toContain(`src="${knee.image}"`);
    expect(html).toContain(">4:12</span>");
    // The back arrow falls back to the category when there is nothing of ours to go back to.
    expect(html).toMatch(link("/library/knee", "Back"));
    // No Transcript or Chapters buttons: nothing that does nothing.
    expect(html).not.toMatch(/Transcript|Chapters/);
  });

  it("lists more in the same category: only what this clinic may use, not the one being watched", async () => {
    signInAs(orgKnee, "Vitest watch clinic (knee)");
    const more = moreColumn(await renderWatch(v.watched));

    expect(more).toContain("More in Knee");
    expect(more).toContain(`href="${watchPageHref(v.other)}"`);
    expect(more).toContain(`href="${watchPageHref(v.placeholder)}"`);
    expect(more).toContain(`Watch ${title("placeholder")} (placeholder animation)`);
    expect(more).not.toContain(`href="${watchPageHref(v.watched)}"`);
    expect(more).not.toContain(title("unpublished"));
    expect(more).not.toContain(title("hip"));
  });

  it("leaves placeholders out of the list for a clinic shown finished animations only", async () => {
    signInAs(orgFinishedOnly, "Vitest watch clinic (finished only)");
    const more = moreColumn(await renderWatch(v.watched));
    expect(more).toContain(title("other"));
    expect(more).not.toContain(title("placeholder"));
  });

  it("carries the placeholder mark for a placeholder", async () => {
    signInAs(orgKnee, "Vitest watch clinic (knee)");
    const html = await renderWatch(v.placeholder);
    // On the picture, and beside the length under it.
    expect(html.match(/Placeholder animation/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("gives a member without a seat Favorite only, and says why there is no Send", async () => {
    signInAs(orgKnee, "Vitest watch clinic (knee)");
    const html = await renderWatch(v.watched);

    expect(html).toMatch(new RegExp(`aria-pressed="false"[^>]*aria-label="Add ${title("watched")} to my favorites"`));
    expect(html).not.toContain("Send to patient");
    expect(html).not.toContain("Show QR on screen");
    expect(html).toContain("needs a surgeon seat");
  });

  it("gives someone holding a seat Send to patient and Show QR on screen, and the heart they chose", async () => {
    await prisma.seatAllocation.create({ data: { clinicId: kneeClinic, clerkUserId: "user_vitestwatch", syncState: "SYNCED" } });
    await setFavorite(kneeClinic, "user_vitestwatch", v.watched, true);
    try {
      signInAs(orgKnee, "Vitest watch clinic (knee)");
      const html = await renderWatch(v.watched);
      expect(html).toContain("Send to patient");
      expect(html).toContain("Show QR on screen");
      expect(html).not.toContain("needs a surgeon seat");
      expect(html).toMatch(new RegExp(`aria-pressed="true"[^>]*aria-label="Remove ${title("watched")} from my favorites"`));
      // The player's mark carries their name as patients see it.
      expect(html).toContain(">Dr. Jane Smith<");
      // No number about plays or hearts anywhere.
      expect(html).not.toMatch(/\b\d+ (plays?|views?|favorites?)\b/i);
    } finally {
      await prisma.seatAllocation.deleteMany({ where: { clinicId: kneeClinic } });
      await prisma.personalVideo.deleteMany({ where: { clinicId: kneeClinic } });
    }
  });

  it("does not count a seat at another clinic", async () => {
    const other = createdClinicIds.find((id) => id !== kneeClinic)!;
    await prisma.seatAllocation.create({ data: { clinicId: other, clerkUserId: "user_vitestwatch", syncState: "SYNCED" } });
    try {
      signInAs(orgKnee, "Vitest watch clinic (knee)");
      expect(await renderWatch(v.watched)).not.toContain("Send to patient");
    } finally {
      await prisma.seatAllocation.deleteMany({ where: { clinicId: other } });
    }
  });
});

describe("any other video id is not found, with nothing playable sent", () => {
  it.each([
    ["a video off the plan (Hip, for a Knee clinic)", () => v.hip],
    ["an unpublished video", () => v.unpublished],
    ["a made-up id", () => "clvitestnotarealvideo0000"],
    ["junk in the address", () => "../../admin"],
    ["an id far too long", () => "a".repeat(200)],
  ])("%s", async (_, id) => {
    signInAs(orgKnee, "Vitest watch clinic (knee)");
    await expect(renderWatch(id())).rejects.toThrow("notFound");
  });

  it("a placeholder, for a clinic shown finished animations only", async () => {
    signInAs(orgFinishedOnly, "Vitest watch clinic (finished only)");
    await expect(renderWatch(v.placeholder)).rejects.toThrow("notFound");
  });

  it("a clinic that is not open gets the calm page, not the video", async () => {
    signInAs(orgPending, "Vitest watch clinic (pending)");
    const html = await renderWatch(v.watched);
    expect(html).toContain("Choose a plan to start");
    expect(html).not.toContain(src("watched"));
  });
});

describe("the library's cards open the watch page", () => {
  it("a card's picture links to the video's watch page, not prefetched", async () => {
    signInAs(orgKnee, "Vitest watch clinic (knee)");
    const html = renderToStaticMarkup(await CategoryPage({ params: Promise.resolve({ category: "knee" }) } as never));
    expect(html).toMatch(link(watchPageHref(v.watched), `Watch ${title("watched")}`));
    // No player opens over the page any more.
    expect(html).not.toContain('role="dialog"');
  });
});

describe("the category's round picture", () => {
  it("is the tile image, cropped to the circle", () => {
    const html = renderToStaticMarkup(<CategoryAvatar image="https://example.com/knee.jpg" label="Knee" />);
    expect(html).toMatch(/<img[^>]*src="https:\/\/example\.com\/knee\.jpg"[^>]*class="h-full w-full object-cover"/);
    expect(html).toContain("rounded-full");
    expect(html).not.toContain("data-category-initial");
  });

  it("is the category's first letter when there is no image", () => {
    const html = renderToStaticMarkup(<CategoryAvatar image="" label="Foot & Ankle" />);
    expect(html).not.toContain("<img");
    expect(html).toMatch(/data-category-initial[^>]*>F</);
  });
});
