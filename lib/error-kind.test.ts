import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { errorKind } from "./error-kind";

/**
 * errorKind() is what the server log gets when something fails. These check
 * it names the kind of failure and never lets the message through, using
 * made-up values only.
 */

const SHARE_CODE = "k7m2xq4v9p";
const CONNECTION = "postgresql://someone:not-a-password@ep-made-up-123.us-east-2.aws.neon.tech/db";

describe("errorKind", () => {
  it("names a Prisma error by its code", () => {
    const error = new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on code ${SHARE_CODE}`, {
      code: "P2002",
      clientVersion: "6.0.0",
    });
    expect(errorKind(error)).toBe("Prisma P2002");
  });

  it("names a Stripe error by its type", () => {
    const error = Object.assign(new Error(`No such customer at ${CONNECTION}`), { type: "StripeConnectionError" });
    expect(errorKind(error)).toBe("StripeConnectionError");
  });

  it("names anything else by its class", () => {
    class ShareTermsError extends Error {
      name = "ShareTermsError";
    }
    expect(errorKind(new ShareTermsError(SHARE_CODE))).toBe("ShareTermsError");
    expect(errorKind(new TypeError(SHARE_CODE))).toBe("TypeError");
    expect(errorKind(new Error(SHARE_CODE))).toBe("Error");
  });

  it("answers plain Error for something that is not an error at all, or has a strange name", () => {
    expect(errorKind(`a bare string with ${SHARE_CODE}`)).toBe("Error");
    expect(errorKind(undefined)).toBe("Error");
    expect(errorKind(null)).toBe("Error");
    expect(errorKind({ name: `looked up /watch/${SHARE_CODE}` })).toBe("Error");
    expect(errorKind({ code: "P2002", message: SHARE_CODE })).toBe("Error");
    expect(errorKind({ type: `Stripe ${CONNECTION}` })).toBe("Error");
  });

  it("never lets the message, a code or a connection string through", () => {
    const failures: unknown[] = [
      new Error(`${CONNECTION} ${SHARE_CODE}`),
      Object.assign(new Error(SHARE_CODE), { type: "StripeAPIError" }),
      new Prisma.PrismaClientKnownRequestError(`${CONNECTION} ${SHARE_CODE}`, { code: "P1001", clientVersion: "6.0.0" }),
      `${CONNECTION} ${SHARE_CODE}`,
    ];
    for (const failure of failures) {
      const kind = errorKind(failure);
      expect(kind).not.toContain(SHARE_CODE);
      expect(kind).not.toContain("neon");
    }
  });
});
