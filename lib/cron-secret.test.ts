import { describe, expect, it } from "vitest";
import { checkCronSecret } from "./cron-secret";

/** The scheduled route's door: made-up secrets only. */

const SECRET = "madeUpCronSecretForTests0123";

describe("the scheduled route's secret check", () => {
  it("lets in exactly the header Vercel sends", () => {
    expect(checkCronSecret(`Bearer ${SECRET}`, SECRET)).toBe("ok");
  });

  it("refuses a missing, wrong, partial or differently written header", () => {
    for (const header of [null, undefined, "", SECRET, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, `bearer ${SECRET}`, `Basic ${SECRET}`, "Bearer "]) {
      expect(checkCronSecret(header, SECRET)).toBe("refused");
    }
  });

  it("fails closed with no secret set, or one too short: even an empty header is not let in", () => {
    for (const secret of [undefined, "", "   ", "short-secret-15"]) {
      expect(checkCronSecret(`Bearer ${secret ?? ""}`, secret)).toBe("not-configured");
      expect(checkCronSecret("Bearer ", secret)).toBe("not-configured");
      expect(checkCronSecret(null, secret)).toBe("not-configured");
    }
  });
});
