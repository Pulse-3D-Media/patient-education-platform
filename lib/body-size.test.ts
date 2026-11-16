import { describe, expect, it } from "vitest";
import { judgeContentLength, MAX_STRIPE_WEBHOOK_BYTES } from "./body-size";

describe("judgeContentLength", () => {
  const MAX = 1000;

  it("lets through no header, zero, and anything up to the limit itself", () => {
    expect(judgeContentLength(null, MAX)).toBe("ok");
    expect(judgeContentLength("0", MAX)).toBe("ok");
    expect(judgeContentLength("999", MAX)).toBe("ok");
    expect(judgeContentLength("1000", MAX)).toBe("ok");
    expect(judgeContentLength(" 1000 ", MAX)).toBe("ok");
  });

  it("refuses one byte over the limit, and any absurdly long number", () => {
    expect(judgeContentLength("1001", MAX)).toBe("too-large");
    expect(judgeContentLength("9".repeat(40), MAX)).toBe("too-large");
  });

  it("calls anything that is not one whole number malformed", () => {
    for (const bad of ["", "-1", "1.5", "1e3", "abc", "100, 100", "0x10"]) {
      expect(judgeContentLength(bad, MAX), bad).toBe("malformed");
    }
  });

  it("allows Stripe 1 MiB, far above any real notification", () => {
    expect(MAX_STRIPE_WEBHOOK_BYTES).toBe(1_048_576);
    expect(judgeContentLength(String(MAX_STRIPE_WEBHOOK_BYTES), MAX_STRIPE_WEBHOOK_BYTES)).toBe("ok");
    expect(judgeContentLength(String(MAX_STRIPE_WEBHOOK_BYTES + 1), MAX_STRIPE_WEBHOOK_BYTES)).toBe("too-large");
  });
});
