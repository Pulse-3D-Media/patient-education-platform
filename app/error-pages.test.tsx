import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LOGO_URL } from "@/lib/brand";
import { SIGN_IN_UNAVAILABLE_DIGEST } from "@/lib/clerk-timeout";
import AdminError from "./admin/error";
import AdminNotFound from "./admin/not-found";
import RootError from "./error";
import GlobalError from "./global-error";
import LibraryError from "./library/error";
import LibraryNotFound from "./library/not-found";
import NotFound from "./not-found";
import PulseError from "./pulse/error";
import PulseNotFound from "./pulse/not-found";
import WatchError from "./watch/error";

/**
 * Every error and not-found page, rendered the way the browser would draw
 * it, handed an error whose message and stack hold exactly the things that
 * must never reach a screen: a connection string, a share code, a file
 * path. No database, no Clerk.
 *
 * What these prove: each page has its calm words and its one action; none
 * shows the message, the stack, the digest or the word "digest"; the
 * patient-facing pages never say "error", "invalid" or a status code; and
 * the sign-in digest changes the heading, and nothing else, on the pages
 * that recognise it. What a render cannot prove, that Next.js routes a real
 * failure to the right one of these files, is the browser check.
 */

const CONNECTION_STRING = "postgresql://neondb_owner:hunter2@ep-secret-host-123456.example.neon.tech/neondb";
const SHARE_CODE = "k7m2xq";

/** A failure the way a page would throw it, with everything sensitive in it. */
function boom(digest = "1234567890") {
  const error = new Error(`Can't reach database server at ${CONNECTION_STRING} while reading share ${SHARE_CODE}`);
  error.stack = `Error: ${error.message}\n    at getShareByCode (lib/db/shares.ts:316:10)`;
  return Object.assign(error, { digest });
}

const retry = () => {};

/** What no page may contain, whoever it is for. */
function expectNothingLeaked(html: string) {
  expect(html).not.toContain(CONNECTION_STRING);
  expect(html).not.toContain("hunter2");
  expect(html).not.toContain(SHARE_CODE);
  expect(html).not.toContain("1234567890");
  expect(html).not.toContain("getShareByCode");
  expect(html).not.toContain("database server");
  expect(html).not.toMatch(/digest/i);
  expect(html).not.toContain("SIGN_IN_UNAVAILABLE");
}

/** The patient page's rules: never "error", "invalid" or a status code, and nothing red. (The logo's address holds a "500" of its own, so it is set aside first.) */
function expectCalmForPatients(html: string) {
  expectNothingLeaked(html);
  const words = html.replaceAll(LOGO_URL, "");
  expect(words).not.toMatch(/error|invalid|403|404|500/i);
  expect(words).not.toMatch(/red-|#e5484d|#ff8a8e/);
  // The Pulse colours stand in for the clinic's, worked out as on the patient page.
  expect(html).toContain("--brand-accent:#1e5668");
}

describe("the patient's error page (app/watch/error.tsx)", () => {
  it("has the calm sentence, one Try again button, and nothing else to click", () => {
    const html = renderToStaticMarkup(<WatchError error={boom()} retry={retry} />);
    expect(html).toContain("Something went wrong loading this video");
    expect(html).toContain("Try again in a moment.");
    expect(html).toContain("Try again</button>");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<input");
    expectCalmForPatients(html);
  });
});

describe("the root error page (app/error.tsx)", () => {
  it("is the neutral calm page for any other failure", () => {
    const html = renderToStaticMarkup(<RootError error={boom()} retry={retry} />);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Try again</button>");
    expect(html).not.toContain("sign-in");
    expectCalmForPatients(html);
  });

  it("says sign-in could not be reached when the digest is the sign-in one, and nothing more", () => {
    const html = renderToStaticMarkup(<RootError error={boom(SIGN_IN_UNAVAILABLE_DIGEST)} retry={retry} />);
    expect(html).toContain("We could not reach sign-in just now");
    expect(html).toContain("Try again</button>");
    expectCalmForPatients(html);
  });
});

describe("the last-resort page (app/global-error.tsx)", () => {
  it("draws its own html and body around the calm page", () => {
    const html = renderToStaticMarkup(<GlobalError error={boom()} retry={retry} />);
    expect(html).toMatch(/^<html lang="en"/);
    expect(html).toContain("<body");
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Try again</button>");
    expectCalmForPatients(html);
  });
});

describe("the root not-found page (app/not-found.tsx)", () => {
  it("is calm, neutral, and has nothing to click", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain("find that page");
    expect(html).toContain("check the address");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<button");
    expectCalmForPatients(html);
  });
});

describe("the staff error pages", () => {
  const pages = [
    { name: "library", render: (error: Error) => <LibraryError error={error} retry={retry} />, back: 'href="/library"', label: "Back to the library" },
    { name: "admin", render: (error: Error) => <AdminError error={error} retry={retry} />, back: 'href="/admin"', label: "Back to the overview" },
    { name: "pulse", render: (error: Error) => <PulseError error={error} retry={retry} />, back: 'href="/pulse"', label: "Back to clinics" },
  ];

  for (const page of pages) {
    it(`${page.name}: a plain sentence, Try again, and its own way back`, () => {
      const html = renderToStaticMarkup(page.render(boom()));
      expect(html).toContain("Something went wrong loading this page");
      expect(html).toContain("Try again in a moment.");
      expect(html).toContain("Try again</button>");
      expect(html).toContain(page.back);
      expect(html).toContain(page.label);
      expect(html).not.toContain("sign-in");
      expectNothingLeaked(html);
    });

    it(`${page.name}: the sign-in digest changes the heading only`, () => {
      const html = renderToStaticMarkup(page.render(boom(SIGN_IN_UNAVAILABLE_DIGEST)));
      expect(html).toContain("We could not reach sign-in just now");
      expect(html).toContain("Try again</button>");
      expect(html).toContain(page.back);
      expectNothingLeaked(html);
    });
  }

  it("uses the colour tokens, never a hex colour, so a light clinic's shell recolours it", () => {
    const html = renderToStaticMarkup(<LibraryError error={boom()} retry={retry} />);
    expect(html).toContain("bg-ground");
    expect(html).toContain("text-ink");
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });
});

describe("the staff not-found pages", () => {
  const pages = [
    { name: "library", render: () => <LibraryNotFound />, back: 'href="/library"' },
    { name: "admin", render: () => <AdminNotFound />, back: 'href="/admin"' },
    { name: "pulse", render: () => <PulseNotFound />, back: 'href="/pulse"' },
  ];

  for (const page of pages) {
    it(`${page.name}: one sentence and a way back, nothing about what was looked for`, () => {
      const html = renderToStaticMarkup(page.render());
      expect(html).toContain("find that page");
      expect(html).toContain(page.back);
      expect(html).not.toMatch(/clinic id|share|code|video id/i);
      expect(html).not.toMatch(/#[0-9a-f]{6}/i);
    });
  }
});
