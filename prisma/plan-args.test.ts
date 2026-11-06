import { describe, expect, it } from "vitest";
import { readPlanCategories, readPlanSeats } from "./plan-args";

/**
 * What `npm run db:set-plan` accepts for --categories and --seats (audit fix
 * list, Prompt R). Plain values only; nothing here touches a database.
 */

const known = ["SPINE", "KNEE", "HIP", "FOOT_ANKLE"];

describe("readPlanCategories", () => {
  it("takes all, none, and a comma-separated list of known keys", () => {
    expect(readPlanCategories("all", known)).toEqual({ ok: true, categories: known });
    expect(readPlanCategories("ALL", known)).toEqual({ ok: true, categories: known });
    expect(readPlanCategories("none", known)).toEqual({ ok: true, categories: [] });
    expect(readPlanCategories("NONE", known)).toEqual({ ok: true, categories: [] });
    expect(readPlanCategories("KNEE,HIP", known)).toEqual({ ok: true, categories: ["KNEE", "HIP"] });
    expect(readPlanCategories(" knee , hip ", known)).toEqual({ ok: true, categories: ["KNEE", "HIP"] });
  });

  it("refuses an empty value instead of reading it as none: none must be typed as the word", () => {
    for (const value of ["", "   ", ",", " , ,"]) {
      const result = readPlanCategories(value, known);
      expect(result.ok, JSON.stringify(value)).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/none/);
    }
  });

  it("refuses a list with a blank entry in it", () => {
    for (const value of ["KNEE,", ",KNEE", "KNEE,,HIP"]) {
      expect(readPlanCategories(value, known).ok, value).toBe(false);
    }
  });

  it("refuses a key it does not know, naming it", () => {
    const result = readPlanCategories("KNEE,ELBOW", known);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("ELBOW");
  });

  it("refuses all or none mixed into a list", () => {
    expect(readPlanCategories("KNEE,none", known).ok).toBe(false);
    expect(readPlanCategories("all,KNEE", known).ok).toBe(false);
  });
});

describe("readPlanSeats", () => {
  it("takes plain digits, 0 or more", () => {
    expect(readPlanSeats("0")).toEqual({ ok: true, seats: 0 });
    expect(readPlanSeats("3")).toEqual({ ok: true, seats: 3 });
    expect(readPlanSeats(" 10 ")).toEqual({ ok: true, seats: 10 });
  });

  it("refuses anything that is not plain digits, however JavaScript would read it", () => {
    for (const value of ["", " ", "0x10", "0b11", "0o7", "1e2", "1.0", "1.5", "-1", "+3", "3 4", "Infinity", "NaN", "٣", "--allow-fewer-seats"]) {
      expect(readPlanSeats(value).ok, JSON.stringify(value)).toBe(false);
    }
  });

  it("refuses a number too big to be a seat count", () => {
    expect(readPlanSeats("99999999999999999999").ok).toBe(false);
  });
});
