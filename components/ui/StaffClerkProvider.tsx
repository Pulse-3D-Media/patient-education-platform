import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

/**
 * Clerk's provider, with our settings, for the staff side of the app.
 *
 * It wraps the library, the admin console and the sign-in page (each of
 * those has a layout that renders this). It deliberately does NOT wrap the
 * whole app: the patient page at /watch never needs Clerk, and wrapping it
 * would load Clerk's script on every patient's phone for nothing. Clerk's
 * docs allow the provider to sit below the root layout for exactly this
 * reason.
 *
 * The publishable key comes from NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY in .env;
 * Clerk reads it itself.
 *
 * `accent` is the clinic's brand colour for Clerk's own pieces (the user
 * menu, the People panel), so they match the screens around them. It is a
 * plain hex colour the server has already checked and adjusted to be
 * readable (staffTheme in lib/branding.ts). Left out, on the sign-in and
 * onboarding pages where there is no clinic yet, it is the Pulse teal.
 *
 * `theme` is the clinic's light-or-dark choice. Clerk's pieces are light
 * panels either way (that is Clerk's own default, and what they were before
 * the choice existed). In a DARK clinic they are left exactly as they were.
 * In a LIGHT clinic they are given the light screens' own white, ink and
 * accent (with the right text colour on the accent), so they match the page
 * around them instead of only resembling it. The values are the same ones
 * app/globals.css gives the light tokens.
 */
export function StaffClerkProvider({
  children,
  accent = "#2a829b",
  onAccent = "#ffffff",
  fontFamily = "var(--font-inter), Inter, sans-serif",
  theme = "dark",
}: {
  children: ReactNode;
  accent?: string;
  /** The text colour that reads on `accent`. Only used in light mode; dark mode leaves Clerk's own choice alone, as before. */
  onAccent?: string;
  fontFamily?: string;
  theme?: "dark" | "light";
}) {
  return (
    <ClerkProvider
      // Where the sign-in page lives. Must match proxy.ts and the <SignIn /> path.
      signInUrl="/sign-in"
      // Where the sign-up page lives, so the sign-in page can link to it. Must match proxy.ts.
      signUpUrl="/sign-up"
      // Where the user button's "Sign out" sends people.
      afterSignOutUrl="/sign-in"
      // Where someone goes after signing up or in when nothing asked for a
      // particular page (a new account, an accepted invitation). /onboarding
      // sends the creator of a clinic that is not paid for yet to Billing and
      // everyone else to the library. Without these Clerk would use the home
      // address, which is the library, where a new clinic only sees "choose a
      // plan". A sign-in that proxy.ts asked for still returns to its page.
      signUpFallbackRedirectUrl="/onboarding"
      signInFallbackRedirectUrl="/onboarding"
      appearance={{
        variables: {
          colorPrimary: accent,
          fontFamily,
          borderRadius: "0.625rem",
          ...(theme === "light"
            ? {
                colorPrimaryForeground: onAccent,
                colorBackground: "#ffffff",
                colorForeground: "#12202a",
                colorMutedForeground: "#52616a",
                colorNeutral: "#12202a",
                colorInput: "#ffffff",
                colorInputForeground: "#12202a",
              }
            : {}),
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
