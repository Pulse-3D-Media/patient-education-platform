import type { ComponentProps } from "react";
import type { SignIn } from "@clerk/nextjs";

/**
 * How Clerk's own sign-in form looks inside the landing page's box, so it
 * matches the design (screen 01) instead of floating as Clerk's card: no
 * title of its own (the box has its tabs and the page its heading), no
 * "Don't have an account?" line (the "Set up a clinic" tab does that job),
 * pill buttons, and "Continue with Google" under the email box, as drawn.
 *
 * Only Clerk's documented styling hooks are used (appearance.options and
 * appearance.elements). Clerk still draws and runs everything inside: the
 * email step, the code step, a second step if an account has one, Google,
 * invitations and choosing a clinic. Its "Secured by Clerk" line and the
 * development-mode badge are left alone.
 *
 * Also used for Clerk's sign-up form, which the box shows for an invitation.
 */
export const BOX_APPEARANCE: ComponentProps<typeof SignIn>["appearance"] = {
  options: { socialButtonsPlacement: "bottom", socialButtonsVariant: "blockButton" },
  elements: {
    rootBox: { width: "100%" },
    cardBox: { width: "100%", maxWidth: "100%", boxShadow: "none", border: "none", borderRadius: "0", overflow: "visible" },
    card: { boxShadow: "none", border: "none", padding: "0", margin: "0", background: "transparent" },
    header: { display: "none" },
    footer: { background: "transparent" },
    footerAction: { display: "none" },
    formFieldLabel: { fontWeight: "600", fontSize: "0.9375rem" },
    formFieldInput: { minHeight: "50px", borderRadius: "12px", fontSize: "1rem" },
    formButtonPrimary: { minHeight: "54px", borderRadius: "999px", fontSize: "1rem", fontWeight: "600", textTransform: "none" },
    socialButtonsBlockButton: { minHeight: "54px", borderRadius: "999px" },
    socialButtonsBlockButtonText: { fontSize: "1rem", fontWeight: "600" },
  },
};

/** Clerk's words that the design changes: "Work email" and its example, as drawn. */
export const BOX_LOCALIZATION = {
  formFieldLabel__emailAddress: "Work email",
  formFieldInputPlaceholder__emailAddress: "name@clinic.com",
  dividerText: "or",
};
