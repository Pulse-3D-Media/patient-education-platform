import { describe, expect, it } from "vitest";
import { planHref, readPlanFromAddress, stepState, stepsDone } from "./sign-up-steps";

/** The sign-up steps' progress list and the plan carried in the address between the plan and payment steps. */

const KNOWN = ["SPINE", "COMPLEX_SPINE", "KNEE", "SHOULDER", "HIP", "FOOT_ANKLE"];

describe("the progress list", () => {
  it("on the plan step: Email done, Plan current, Payment later, and 1 of 3 done (as drawn)", () => {
    expect(stepState("email", "plan")).toBe("done");
    expect(stepState("plan", "plan")).toBe("current");
    expect(stepState("payment", "plan")).toBe("later");
    expect(stepsDone("plan")).toBe(1);
    expect(stepsDone("payment")).toBe(2);
  });
});

describe("the plan in the address", () => {
  it("goes there and comes back the same, in library order", () => {
    const href = planHref({ categories: ["KNEE", "HIP"], seats: 3, interval: "YEAR" });
    expect(href).toBe("/onboarding/payment?categories=KNEE%2CHIP&seats=3&interval=YEAR");
    const params = Object.fromEntries(new URL(href, "https://example.test").searchParams);
    expect(readPlanFromAddress(params, KNOWN)).toEqual({ categories: ["KNEE", "HIP"], seats: 3, interval: "YEAR" });
    expect(readPlanFromAddress({ categories: "HIP,KNEE", seats: "3", interval: "MONTH" }, KNOWN)?.categories).toEqual(["KNEE", "HIP"]);
    expect(planHref({ categories: ["KNEE"], seats: 1, interval: "MONTH" }, "plan")).toMatch(/^\/onboarding\/plan\?/);
  });

  it("refuses anything it does not recognise rather than guessing", () => {
    const good = { categories: "KNEE", seats: "3", interval: "MONTH" };
    expect(readPlanFromAddress({}, KNOWN)).toBeNull();
    expect(readPlanFromAddress({ ...good, categories: "KNEE,ELBOW" }, KNOWN)).toBeNull();
    expect(readPlanFromAddress({ ...good, categories: "KNEE,KNEE" }, KNOWN)).toBeNull();
    expect(readPlanFromAddress({ ...good, categories: "" }, KNOWN)).toBeNull();
    expect(readPlanFromAddress({ ...good, seats: "0" }, KNOWN)).toBeNull();
    expect(readPlanFromAddress({ ...good, seats: "2.5" }, KNOWN)).toBeNull();
    expect(readPlanFromAddress({ ...good, seats: "-1" }, KNOWN)).toBeNull();
    expect(readPlanFromAddress({ ...good, interval: "WEEK" }, KNOWN)).toBeNull();
    expect(readPlanFromAddress({ ...good, categories: ["KNEE", "HIP"] }, KNOWN)).toBeNull();
  });
});
