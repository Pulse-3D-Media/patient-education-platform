import { describe, expect, it } from "vitest";
import { signInHandoffHref } from "./invitation-handoff";

describe("signInHandoffHref", () => {
  it("carries Clerk's status and ticket to /sign-in unchanged", () => {
    expect(signInHandoffHref({ __clerk_status: "sign_in", __clerk_ticket: "made.up.ticket" })).toBe("/sign-in?__clerk_status=sign_in&__clerk_ticket=made.up.ticket");
  });

  it("leaves everything else behind: an added redirect, junk, and repeated values", () => {
    const href = signInHandoffHref({
      __clerk_status: "sign_in",
      __clerk_ticket: "made.up.ticket",
      redirect_url: "https://evil.example/",
      sign_in_force_redirect_url: "https://evil.example/",
      junk: "x",
      __clerk_db_jwt: ["a", "b"],
    });
    expect(href).toBe("/sign-in?__clerk_status=sign_in&__clerk_ticket=made.up.ticket");
  });

  it("sends nothing it was not given, and never a repeated ticket", () => {
    expect(signInHandoffHref({ __clerk_status: "sign_in" })).toBe("/sign-in?__clerk_status=sign_in");
    expect(signInHandoffHref({ __clerk_status: "sign_in", __clerk_ticket: ["one", "two"] })).toBe("/sign-in?__clerk_status=sign_in");
  });
});
