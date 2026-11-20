import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The join screen (app/onboarding/join): who sees the name and credential
 * form and who is sent straight on to the library, with Clerk, the database
 * and the seat check replaced. The form itself is the shared SenderNameForm,
 * tested on its own; the save is the Send panel's action, tested in the
 * library's tests.
 */

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: "user_vitestmarcus" })) }));
vi.mock("@clerk/nextjs", () => ({ SignOutButton: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/lib/clinic", () => ({ requireClinicPage: vi.fn() }));
vi.mock("@/lib/db/seats", () => ({ getSeatFor: vi.fn() }));
vi.mock("@/lib/seat-changes", () => ({ checkSeats: vi.fn(async () => ({})) }));
vi.mock("@/lib/db/shares", () => ({ getShareTerms: vi.fn(async () => null) }));
vi.mock("@/app/library/[category]/actions", () => ({ setMyPatientNameAction: vi.fn() }));

const { requireClinicPage } = await import("@/lib/clinic");
const { getSeatFor } = await import("@/lib/db/seats");
const { checkSeats } = await import("@/lib/seat-changes");
const { default: JoinPage } = await import("./page");

const clinic = (over: Record<string, unknown> = {}) =>
  ({
    id: "clinic_vitest",
    name: "Wasatch Orthopedics",
    logoUrl: null,
    phone: null,
    isOwner: false,
    isAdmin: false,
    defaultPatientName: "Marcus Lee",
    branding: { color: null, font: "inter", theme: "light" },
    ...over,
  }) as never;

async function where(): Promise<string> {
  try {
    return renderToStaticMarkup(await JoinPage());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("redirect:")) return error.message;
    throw error;
  }
}

beforeEach(() => vi.clearAllMocks());

describe("the join screen", () => {
  it("shows a newly invited person holding a seat the form for their own name and credential", async () => {
    vi.mocked(requireClinicPage).mockResolvedValue(clinic());
    vi.mocked(getSeatFor).mockResolvedValue({ displayName: null });
    const html = await where();
    expect(html).toContain("Join Wasatch Orthopedics");
    expect(html).toContain("Join and open the library");
    expect(html).toContain("Sign out");
    expect(html).not.toContain(">Cancel<");
    expect(checkSeats).not.toHaveBeenCalled();
  });

  it("turns the invitation's held seat into theirs first when that has not happened yet", async () => {
    vi.mocked(requireClinicPage).mockResolvedValue(clinic());
    vi.mocked(getSeatFor).mockResolvedValueOnce(null).mockResolvedValueOnce({ displayName: null });
    expect(await where()).toContain("Join and open the library");
    expect(checkSeats).toHaveBeenCalledWith("clinic_vitest");
  });

  it("sends everyone with nothing to enter on to the library: the owner, someone with no seat (offered the tour once), someone whose name is chosen", async () => {
    vi.mocked(requireClinicPage).mockResolvedValue(clinic({ isOwner: true, isAdmin: true }));
    expect(await where()).toBe("redirect:/library");

    // Just joined, with no seat and so no name to choose: the library home, with the quick tour offered once.
    vi.mocked(requireClinicPage).mockResolvedValue(clinic());
    vi.mocked(getSeatFor).mockResolvedValue(null);
    expect(await where()).toBe("redirect:/library?tour=offer");

    vi.mocked(getSeatFor).mockResolvedValue({ displayName: "Marcus Lee, DO" });
    expect(await where()).toBe("redirect:/library");
  });
});
