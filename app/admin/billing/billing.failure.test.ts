import { afterEach, describe, expect, it, vi } from "vitest";
import { getClinicPlan } from "@/lib/db/clinics";
import { getPricingForClinic } from "@/lib/db/pricing";
import { getBillingView } from "./billing";

/**
 * The billing view when the prices cannot be read at all: a database that
 * is behind on migrations, a lost connection. The plan still shows and the
 * estimate becomes a plain sentence; the page never crashes. No database
 * here: both reads are stand-ins.
 */

vi.mock("@/lib/db/clinics", () => ({ getClinicPlan: vi.fn() }));
vi.mock("@/lib/db/pricing", () => ({
  getPricingForClinic: vi.fn(),
  PricingError: class PricingError extends Error {},
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getBillingView when the prices cannot be read", () => {
  it("still returns the plan, with a plain problem instead of an estimate, and logs the detail", async () => {
    vi.mocked(getClinicPlan).mockResolvedValue({ categories: ["KNEE"], surgeonSeats: 2, managedByPulse: false });
    vi.mocked(getPricingForClinic).mockRejectedValue(new Error('The table "public.PricingVersion" does not exist'));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const view = await getBillingView("clinic_1");

    expect(view).toEqual({
      plan: { categories: ["KNEE"], surgeonSeats: 2, managedByPulse: false },
      hasPlan: true,
      estimate: null,
      problem: "We could not work out an estimate right now. Your plan is unchanged.",
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("does not exist");
  });
});
