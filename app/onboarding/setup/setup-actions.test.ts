import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The setup steps' Server Actions and the page guard, with every outside
 * piece replaced: who is asking, the existing actions each step reuses, and
 * the setup write. What these prove is the order and the gates: only an
 * office admin of an open clinic gets anywhere; a step is marked done only
 * after its own change succeeded; invitations go out one by one as members,
 * and the step is done only when all went out; the test link is made from
 * the signed-in admin through createShare. The real writes are tested in
 * lib/db/setup.test.ts and the seat rules in lib/db/owner-auto-seat.test.ts.
 */

const redirects: string[] = [];
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirects.push(to);
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: "user_vitestadmin" })) }));
vi.mock("@/lib/roles", () => ({ isClinicAdmin: vi.fn(async () => true) }));
vi.mock("@/lib/clinic", () => ({ getCurrentClinicId: vi.fn(async () => "clinic_vitest"), requireClinicPage: vi.fn() }));
vi.mock("@/lib/db/setup", () => ({ recordSetupStep: vi.fn() }));
vi.mock("@/app/admin/people/actions", () => ({ inviteAction: vi.fn() }));
vi.mock("@/app/admin/branding/actions", () => ({ saveClinicNameAction: vi.fn(), saveClinicBrandingPartAction: vi.fn() }));
vi.mock("@/lib/senders", () => ({ resolveSender: vi.fn() }));
vi.mock("@/lib/db/shares", async () => {
  class ShareRefusedError extends Error {}
  class SenderRefusedError extends Error {}
  return { createShare: vi.fn(), ShareRefusedError, SenderRefusedError, getShareTerms: vi.fn() };
});
vi.mock("@/lib/qr-code", () => ({ qrOriginFor: () => ({ origin: "http://localhost:3000", testOnly: true }) }));
vi.mock("@/lib/qr", () => ({ qrSvg: async () => "<svg></svg>" }));

const { isClinicAdmin } = await import("@/lib/roles");
const { getCurrentClinicId, requireClinicPage } = await import("@/lib/clinic");
const { recordSetupStep } = await import("@/lib/db/setup");
const { inviteAction } = await import("@/app/admin/people/actions");
const { saveClinicNameAction, saveClinicBrandingPartAction } = await import("@/app/admin/branding/actions");
const { resolveSender } = await import("@/lib/senders");
const { createShare } = await import("@/lib/db/shares");
const actions = await import("./actions");
const { requireSetup } = await import("./setup-view");

const progressAt = (current: string | null) => ({ current, finished: current === null, doneCount: 1, total: 4, steps: [] });

/** Run an action, and say where it sent the browser (or what it answered). */
async function outcome<T>(run: () => Promise<T>): Promise<T | string> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("redirect:")) return error.message;
    throw error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  redirects.length = 0;
  vi.mocked(isClinicAdmin).mockResolvedValue(true);
  vi.mocked(getCurrentClinicId).mockResolvedValue("clinic_vitest");
  vi.mocked(recordSetupStep).mockImplementation(async (_clinicId, step) => progressAt(step === "test" ? null : "branding") as never);
});

describe("the gate", () => {
  it("refuses a member, and a clinic that is not open, and writes nothing", async () => {
    vi.mocked(isClinicAdmin).mockResolvedValue(false);
    expect(await outcome(() => actions.skipSetupStepAction("clinic"))).toMatchObject({ error: expect.stringContaining("office admins") });
    vi.mocked(isClinicAdmin).mockResolvedValue(true);
    vi.mocked(getCurrentClinicId).mockResolvedValue(null);
    expect(await outcome(() => actions.finishTestStepAction())).toMatchObject({ error: expect.stringContaining("office admins") });
    expect(await outcome(() => actions.sendSetupInvitationsAction(["a@clinic.example"]))).toMatchObject({ error: expect.any(String) });
    expect(await outcome(() => actions.makeTestLinkAction("video_1"))).toMatchObject({ ok: false });
    expect(recordSetupStep).not.toHaveBeenCalled();
    expect(inviteAction).not.toHaveBeenCalled();
    expect(createShare).not.toHaveBeenCalled();
  });

  it("refuses a step that does not exist", async () => {
    expect(await outcome(() => actions.skipSetupStepAction("payments"))).toEqual({ error: "That step could not be found." });
  });

  it("Skip records the step as skipped for the signed-in admin's own clinic, and moves on", async () => {
    expect(await outcome(() => actions.skipSetupStepAction("branding"))).toBe("redirect:/onboarding/setup/branding");
    expect(recordSetupStep).toHaveBeenCalledWith("clinic_vitest", "branding", "skipped");
  });
});

describe("step 1, the clinic's name and phone", () => {
  const form = (name: string, previousName: string, phone = "") => {
    const data = new FormData();
    data.set("name", name);
    data.set("previousName", previousName);
    data.set("phone", phone);
    return data;
  };

  it("renames through Clinic branding's rename only when the name changed, saves the phone, then marks the step done", async () => {
    vi.mocked(saveClinicNameAction).mockResolvedValue({ ok: "Saved." });
    vi.mocked(saveClinicBrandingPartAction).mockResolvedValue({ ok: "Saved." });
    expect(await outcome(() => actions.saveClinicStepAction(null, form("Wasatch Orthopedics", "Jane Smith's clinic", "8015550123")))).toBe("redirect:/onboarding/setup/branding");
    expect(saveClinicNameAction).toHaveBeenCalledTimes(1);
    expect(saveClinicBrandingPartAction).toHaveBeenCalledWith("phone", expect.any(FormData));
    expect(recordSetupStep).toHaveBeenCalledWith("clinic_vitest", "clinic", "done");

    vi.clearAllMocks();
    vi.mocked(saveClinicBrandingPartAction).mockResolvedValue({ ok: "Saved." });
    vi.mocked(recordSetupStep).mockResolvedValue(progressAt("branding") as never);
    await outcome(() => actions.saveClinicStepAction(null, form("Wasatch Orthopedics", "Wasatch Orthopedics")));
    expect(saveClinicNameAction).not.toHaveBeenCalled();
  });

  it("a refused rename or phone keeps the step where it is and says why beside the box", async () => {
    vi.mocked(saveClinicNameAction).mockResolvedValue({ error: "We could not reach the sign-in service to rename your clinic, so nothing was changed. Try again in a moment." });
    expect(await outcome(() => actions.saveClinicStepAction(null, form("New name", "Old name")))).toMatchObject({ fieldErrors: { name: expect.stringContaining("rename") } });
    vi.mocked(saveClinicNameAction).mockResolvedValue({ ok: "Saved." });
    vi.mocked(saveClinicBrandingPartAction).mockResolvedValue({ error: "That does not look like a US phone number. Ten digits, any format." });
    expect(await outcome(() => actions.saveClinicStepAction(null, form("New name", "Old name", "12")))).toMatchObject({ fieldErrors: { phone: expect.stringContaining("phone") } });
    expect(await outcome(() => actions.saveClinicStepAction(null, form("  ", "Old name")))).toMatchObject({ fieldErrors: { name: "Type your clinic's name." } });
    expect(recordSetupStep).not.toHaveBeenCalled();
  });
});

describe("step 3, invitations", () => {
  it("sends each address once, as a member, and marks the step done only when all went out", async () => {
    vi.mocked(inviteAction).mockResolvedValue({ message: "Invitation sent." });
    expect(await outcome(() => actions.sendSetupInvitationsAction(["a@clinic.example", " a@clinic.example ", "", "b@clinic.example"]))).toBe("redirect:/onboarding/setup/branding");
    expect(vi.mocked(inviteAction).mock.calls).toEqual([
      ["a@clinic.example", "member"],
      ["b@clinic.example", "member"],
    ]);
    expect(recordSetupStep).toHaveBeenCalledWith("clinic_vitest", "team", "done");
  });

  it("answers a bad or repeated address on its own, keeps going, and leaves the step open", async () => {
    vi.mocked(inviteAction).mockImplementation(async (email) =>
      email === "not-an-email" ? { error: "Enter an email address, like name@clinic.com." } : email === "taken@clinic.example" ? { error: "taken@clinic.example already has an open invitation. Revoke it first to send a new one." } : { message: "Sent." },
    );
    const result = await outcome(() => actions.sendSetupInvitationsAction(["not-an-email", "taken@clinic.example", "ok@clinic.example"]));
    expect(result).toEqual({
      sent: ["ok@clinic.example"],
      failed: [
        { email: "not-an-email", message: "Enter an email address, like name@clinic.com." },
        { email: "taken@clinic.example", message: "taken@clinic.example already has an open invitation. Revoke it first to send a new one." },
      ],
    });
    expect(recordSetupStep).not.toHaveBeenCalled();
  });

  it("asks for an address when every box is empty, and refuses a list that is not text", async () => {
    expect(await outcome(() => actions.sendSetupInvitationsAction(["", "  "]))).toMatchObject({ error: expect.stringContaining("Skip for now") });
    expect(await outcome(() => actions.sendSetupInvitationsAction("a@clinic.example"))).toMatchObject({ error: expect.any(String) });
    expect(await outcome(() => actions.sendSetupInvitationsAction([1, 2]))).toMatchObject({ error: expect.any(String) });
    expect(inviteAction).not.toHaveBeenCalled();
  });
});

describe("step 4, the test link", () => {
  it("makes an ordinary link from the signed-in admin through createShare, and returns its address and QR code", async () => {
    vi.mocked(resolveSender).mockResolvedValue({ ok: true, sender: { clerkUserId: "user_vitestadmin", name: "Jane Smith" } } as never);
    vi.mocked(createShare).mockResolvedValue({ code: "vitestcode1" } as never);
    expect(await actions.makeTestLinkAction(" video_1 ")).toEqual({ ok: true, url: "http://localhost:3000/watch/vitestcode1", qr: "<svg></svg>" });
    expect(resolveSender).toHaveBeenCalledWith("clinic_vitest", "user_vitestadmin");
    expect(createShare).toHaveBeenCalledWith("clinic_vitest", "video_1", { sender: { clerkUserId: "user_vitestadmin", name: "Jane Smith" } });
  });

  it("says why when the admin cannot send links (no seat), and makes nothing", async () => {
    vi.mocked(resolveSender).mockResolvedValue({ ok: false, message: "That person does not hold a seat." });
    expect(await actions.makeTestLinkAction("video_1")).toEqual({ ok: false, error: "That person does not hold a seat." });
    expect(createShare).not.toHaveBeenCalled();
  });

  it("Finish marks the last step done and goes to the finished page", async () => {
    expect(await outcome(() => actions.finishTestStepAction())).toBe("redirect:/onboarding/setup/done");
    expect(recordSetupStep).toHaveBeenCalledWith("clinic_vitest", "test", "done");
  });
});

describe("who may open setup (requireSetup)", () => {
  const clinic = (over: Record<string, unknown>) => ({ id: "clinic_vitest", status: "ACTIVE", graceEndsAt: null, isAdmin: true, setup: progressAt("clinic"), ...over });

  it("a member goes to the library, a closed clinic to Billing, a clinic made before setup to the overview", async () => {
    vi.mocked(requireClinicPage).mockResolvedValue(clinic({ isAdmin: false }) as never);
    expect(await outcome(() => requireSetup())).toBe("redirect:/library");
    vi.mocked(requireClinicPage).mockResolvedValue(clinic({ status: "PENDING" }) as never);
    expect(await outcome(() => requireSetup())).toBe("redirect:/admin/billing");
    vi.mocked(requireClinicPage).mockResolvedValue(clinic({ setup: null }) as never);
    expect(await outcome(() => requireSetup())).toBe("redirect:/admin");
  });

  it("an admin of an open clinic going through setup is let in", async () => {
    vi.mocked(requireClinicPage).mockResolvedValue(clinic({}) as never);
    expect(await outcome(() => requireSetup())).toMatchObject({ progress: { current: "clinic" } });
  });
});
