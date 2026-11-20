import { auth } from "@clerk/nextjs/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "./page";
import SignInPage from "./sign-in/[[...sign-in]]/page";
import SignUpPage from "./sign-up/[[...sign-up]]/page";

/**
 * The three pages that draw the landing page: the bare address, /sign-in
 * and /sign-up. Clerk is a stand-in here, so this proves which page and
 * which form each visitor gets, and where they are sent. It does not prove
 * Clerk's own forms, the email code or the redirect after sign-up, which
 * need a real browser against Clerk (listed in the pull request).
 */

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ClerkLoading: () => null,
  ClerkFailed: () => null,
  SignIn: (props: { path?: string; routing?: string }) => <span data-testid="clerk-sign-in" data-path={props.path ?? ""} data-routing={props.routing ?? ""} />,
  SignUp: (props: { path?: string; forceRedirectUrl?: string }) => <span data-testid="clerk-sign-up" data-path={props.path ?? ""} data-after={props.forceRedirectUrl ?? ""} />,
  AuthenticateWithRedirectCallback: () => <span data-testid="clerk-sso-callback" />,
  TaskChooseOrganization: () => <span data-testid="clerk-choose-organization" />,
  useSignUp: () => ({ signUp: {} }),
  useAuth: () => ({ isLoaded: false }),
  useClerk: () => ({}),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

function signedIn(userId: string | null) {
  vi.mocked(auth).mockResolvedValue({ userId } as never);
}

const query = (values: Record<string, string>) => Promise.resolve(values);
const steps = (list: string[] = []) => Promise.resolve({ "sign-up": list.length ? list : undefined });

async function where(draw: () => Promise<unknown>) {
  try {
    await draw();
    return "stayed";
  } catch (error) {
    return (error as Error).message;
  }
}

beforeEach(() => vi.resetAllMocks());

describe("the bare address", () => {
  it("sends a signed-in person to /onboarding, exactly as before, never straight to the library", async () => {
    signedIn("user_vitest");
    expect(await where(() => Home())).toBe("redirect:/onboarding");
  });

  it("shows a signed-out visitor the landing page, with Clerk's own sign-in form in the box", async () => {
    signedIn(null);
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Welcome <span");
    expect(html).toContain("You explain it once.");
    expect(html).toContain("Let the animation re-explain when needed.");
    expect(html).toContain('data-testid="clerk-sign-in"');
    // Its steps live after a "#", since its usual sub-paths are under /sign-in.
    expect(html).toContain('data-routing="hash"');
    // Both tabs, with Sign in open.
    expect(html).toMatch(/<a href="\/sign-in" aria-current="page"[^>]*>Sign in<\/a>/);
    expect(html).toMatch(/<a href="\/sign-up"[^>]*>Set up a clinic<\/a>/);
    expect(html).toContain("Patient with a link? Just open it. No account needed.");
  });

  it("draws the website's navigation, and the three ways pictures with a silent, lazy video", async () => {
    signedIn(null);
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('href="https://www.pulse3dmedia.com/earlyaccess" aria-current="page"');
    expect(html).toContain("Schedule a Call");
    // No address for the video until it is on screen, no autoplay, muted, nothing loaded ahead.
    const videos = html.match(/<video[^>]*>/g) ?? [];
    expect(videos.length).toBe(2);
    for (const video of videos) {
      expect(video).not.toMatch(/\ssrc=/);
      expect(video).not.toContain("autoplay");
      expect(video).toContain('preload="none"');
      expect(video).toContain("muted");
    }
    for (const img of html.match(/<img[^>]*website-files[^>]*>/g) ?? []) expect(img).toContain('loading="lazy"');
  });

  it("puts no price and no em dash on the page", async () => {
    signedIn(null);
    const html = renderToStaticMarkup(await Home());
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toContain("—");
  });
});

describe("/sign-in", () => {
  it("is the landing page with Clerk's path-routed sign-in form", async () => {
    const html = renderToStaticMarkup(await SignInPage({ params: Promise.resolve({}), searchParams: query({}) } as never));
    expect(html).toContain('data-testid="clerk-sign-in"');
    expect(html).toContain('data-path="/sign-in"');
  });

  it("carries the page someone was sent from to the Set up a clinic tab, so a sign-up returns there", async () => {
    const html = renderToStaticMarkup(await SignInPage({ params: Promise.resolve({}), searchParams: query({ redirect_url: "http://localhost:3000/library" }) } as never));
    expect(html).toContain('href="/sign-up?redirect_url=http%3A%2F%2Flocalhost%3A3000%2Flibrary"');
  });
});

describe("/sign-up", () => {
  const draw = (values: Record<string, string>, path: string[] = []) => SignUpPage({ params: steps(path), searchParams: query(values) } as never);

  it("shows our two boxes, Your name and Work email, and no password box, to a new visitor", async () => {
    signedIn(null);
    const html = renderToStaticMarkup(await draw({}));
    expect(html).toContain("Set up your <span");
    expect(html).toContain(">Your name</label>");
    expect(html).toContain(">Work email</label>");
    expect(html).not.toContain('type="password"');
    expect(html).toContain('id="clerk-captcha"');
    expect(html).toContain("Continue with Google");
    expect(html).not.toContain('data-testid="clerk-sign-up"');
    expect(html).toMatch(/<a href="\/sign-up" aria-current="page"[^>]*>Set up a clinic<\/a>/);
  });

  it("sends someone already signed in to /onboarding instead of a second account", async () => {
    signedIn("user_vitest");
    expect(await where(() => draw({}))).toBe("redirect:/onboarding");
  });

  it("an invitation for a new person gets Clerk's own sign-up form, which then opens the join screen", async () => {
    const html = renderToStaticMarkup(await draw({ __clerk_status: "sign_up", __clerk_ticket: "made.up.ticket" }));
    expect(html).toContain('data-testid="clerk-sign-up"');
    expect(html).toContain('data-path="/sign-up"');
    expect(html).toContain('data-after="/onboarding/join"');
    expect(html).not.toContain(">Your name</label>");
    // The invitation's ticket never leaks into the page.
    expect(html).not.toContain("made.up.ticket");
    expect(auth).not.toHaveBeenCalled();
  });

  it("says Accept your invitation, names the clinic from the accept address, and offers no Set up a clinic tab (Evan, 2026-11-20)", async () => {
    const named = renderToStaticMarkup(await draw({ __clerk_status: "sign_up", __clerk_ticket: "made.up.ticket", clinic: "Wasatch Orthopedics" }));
    expect(named).toContain("Accept your invitation to join Wasatch Orthopedics.");
    expect(named).not.toContain("Set up your <span");
    expect(named).not.toContain(">Set up a clinic</a>");
    expect(named).not.toContain(">Sign in</a>");

    // No name, or one that is not usable: the plain heading. Words only: markup in the name is shown as text.
    const plain = renderToStaticMarkup(await draw({ __clerk_ticket: "made.up.ticket" }));
    expect(plain).toContain("Accept your invitation.");
    const tooLong = renderToStaticMarkup(await draw({ __clerk_ticket: "made.up.ticket", clinic: "x".repeat(81) }));
    expect(tooLong).toContain("Accept your invitation.");
    const markup = renderToStaticMarkup(await draw({ __clerk_ticket: "made.up.ticket", clinic: "<b>Clinic</b>" }));
    expect(markup).toContain("&lt;b&gt;Clinic&lt;/b&gt;");
    expect(markup).not.toContain("<b>Clinic</b>");

    // A name in the address without an invitation changes nothing: the usual sign-up page.
    signedIn(null);
    const notInvited = renderToStaticMarkup(await draw({ clinic: "Wasatch Orthopedics" }));
    expect(notInvited).toContain("Set up your <span");
    expect(notInvited).not.toContain("Wasatch Orthopedics");
  });

  it("an invitation for someone with an account, or one already accepted, is sent on: to sign in, or to the join screen once accepted", async () => {
    expect(await where(() => draw({ __clerk_status: "sign_in", __clerk_ticket: "made.up.ticket" }))).toBe(
      "redirect:/sign-in?__clerk_status=sign_in&__clerk_ticket=made.up.ticket",
    );
    expect(await where(() => draw({ __clerk_status: "complete" }))).toBe("redirect:/onboarding/join");
  });

  it("Google comes back to Clerk's own callback, and Clerk's later steps keep Clerk's form", async () => {
    expect(renderToStaticMarkup(await draw({}, ["sso-callback"]))).toContain('data-testid="clerk-sso-callback"');
    expect(renderToStaticMarkup(await draw({}, ["continue"]))).toContain('data-testid="clerk-sign-up"');
  });
});
