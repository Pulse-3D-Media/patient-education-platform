"use client";

import { CalmError } from "@/components/ui/CalmError";
import { isSignInUnavailable } from "@/lib/clerk-timeout";

/**
 * The error page for anything under app/ that has no closer one. In
 * practice that is a staff layout failing before it could draw its shell
 * (/pulse asking Clerk who is signed in, /onboarding, the sign-in pages),
 * since /library and /admin keep their shell when the clinic cannot be
 * read (getClinicForShell in lib/clinic.ts) and the patient page has its
 * own (app/watch/error.tsx).
 *
 * It draws inside the root layout (so the stylesheet and the font are
 * there) and is the calm neutral page, because at this level the app does
 * not know who is looking. The one thing read from the error is whether
 * its digest is the sign-in one (lib/clerk-timeout.ts), which changes the
 * heading and nothing else. Never the error itself, its message or its
 * digest. The detail is in the server log.
 */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const signIn = isSignInUnavailable(error);
  return <CalmError heading={signIn ? "We could not reach sign-in just now" : "Something went wrong"} body="Try again in a moment." retry={retry} />;
}
