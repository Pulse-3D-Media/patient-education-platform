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
 */
export function StaffClerkProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      // Where the sign-in page lives. Must match proxy.ts and the <SignIn /> path.
      signInUrl="/sign-in"
      // Where the sign-up page lives, so the sign-in page can link to it. Must match proxy.ts.
      signUpUrl="/sign-up"
      // Where the user button's "Sign out" sends people.
      afterSignOutUrl="/sign-in"
      appearance={{
        variables: {
          colorPrimary: "#2a829b",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          borderRadius: "0.625rem",
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
