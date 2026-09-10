import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Clerk's request middleware. Next.js 16 calls this file proxy.ts (it was
 * middleware.ts in Next.js 15 and earlier). It runs before every request
 * that matches `config.matcher` below.
 *
 * Two jobs:
 *
 *   1. Let Clerk read the session cookie, so that auth() works in pages,
 *      Server Actions and Route Handlers. This is what clerkMiddleware() does
 *      on its own, for every matched request, signed in or not.
 *
 *   2. Send signed-out visitors of the staff surfaces (/admin, /library and
 *      /pulse) to the sign-in page, and bring them back to the page they
 *      wanted once they have signed in.
 *
 * Clerk's current guidance is that this redirect is a convenience, not the
 * security boundary: every page, action and handler that reads clinic data
 * still checks the signed-in user itself (through auth.protect() or
 * getCurrentClinicId()). Keep both.
 *
 * Everything not listed in STAFF_PATHS is public. That covers the patient
 * page (/watch), the sign-in page, and later /q and /api/webhooks.
 */

/** The path prefixes that need a signed-in user. Everything under them too. */
const STAFF_PATHS = ["/admin", "/library", "/pulse"];

function isStaffPath(pathname: string) {
  return STAFF_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export default clerkMiddleware(
  async (auth, request) => {
    if (!isStaffPath(request.nextUrl.pathname)) return;

    const { isAuthenticated, redirectToSignIn } = await auth();
    if (!isAuthenticated) {
      // returnBackUrl is where Clerk sends them after signing in.
      return redirectToSignIn({ returnBackUrl: request.url });
    }
  },
  {
    // Where the sign-in page lives. Set here in code rather than through the
    // NEXT_PUBLIC_CLERK_SIGN_IN_URL environment variable so it cannot go
    // missing on a deployment. The same path is given to ClerkProvider and
    // to the <SignIn /> component; keep the three in step.
    signInUrl: "/sign-in",
  },
);

// Which requests the middleware runs for. This is Clerk's recommended matcher:
// every page and API route, but not Next.js internals or static files.
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
