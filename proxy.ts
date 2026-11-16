import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

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
 *   2. Send signed-out visitors of the staff surfaces (/admin, /library,
 *      /pulse and /onboarding) to the sign-in page, and bring them back to the page they
 *      wanted once they have signed in.
 *
 * Clerk's current guidance is that this redirect is a convenience, not the
 * security boundary: every page, action and handler that reads clinic data
 * still checks the signed-in user itself (through auth.protect() or
 * getCurrentClinicId()). Keep both.
 *
 * Everything not listed in STAFF_PATHS is public. That covers the patient
 * page (/watch), the sign-in and sign-up pages, the health check
 * (/api/health, for an uptime monitor), /api/webhooks, and /q (a printed QR
 * code's page, and the route its Play tap posts to).
 *
 * Fewer outside calls on public paths (CLAUDE.md, "Auth"). Clerk's middleware
 * looks at every request it is handed BEFORE our code below runs, and some
 * made-up credentials make it ask Clerk's servers about them, once per
 * request (five times, with its retries, for a made-up session token). So
 * the exported function at the bottom does two things first:
 *
 *   - The paths in NO_CLERK_PATHS never reach Clerk's middleware at all. None
 *     of them needs to know who is signed in: the patient page and its
 *     routes, a printed code's page and its routes, the health check and the
 *     webhooks (Stripe and Mux prove themselves with their own signatures).
 *     The renewal email a paused link's "Ask my clinic" sends still works:
 *     Clerk's backend client reads its keys from the environment when the
 *     middleware did not run.
 *
 *   - Any other request carrying an Authorization header is answered 401
 *     before Clerk sees it. The app never signs anyone in with a header
 *     (staff are signed in by Clerk's cookie), so only a script sends one.
 *
 * lib/proxy-clerk-calls.test.ts counts the calls and fails if either goes.
 */

/** The path prefixes that need a signed-in user. Everything under them too. */
const STAFF_PATHS = ["/admin", "/library", "/pulse", "/onboarding"];

/** Path prefixes that never need to know who is signed in, so Clerk is not asked. Everything under them too. */
const NO_CLERK_PATHS = ["/watch", "/q", "/api/health", "/api/webhooks"];

function isUnder(pathname: string, prefixes: string[]) {
  return prefixes.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isStaffPath(pathname: string) {
  return isUnder(pathname, STAFF_PATHS);
}

const clerk = clerkMiddleware(
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
    // Where the sign-up page lives, so the sign-in page can link to it.
    signUpUrl: "/sign-up",
    // The Clerk forward is OFF, on purpose (CLAUDE.md, "Auth"). Clerk's
    // middleware can pass requests under /__clerk on to Clerk's servers, and
    // left to itself turns that on for a live key on a *.vercel.app address.
    // We do not use it: the browser talks to Clerk directly. Saying so here
    // means the choice no longer depends on which key or address is in use.
    // lib/proxy-clerk-forward.test.ts fails if this line goes.
    frontendApiProxy: { enabled: false },
  },
);

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // The patient's pages, printed codes, health check and webhooks: straight
  // on, with Clerk never involved (see the top of this file).
  if (isUnder(request.nextUrl.pathname, NO_CLERK_PATHS)) return NextResponse.next();

  // Nobody here signs in with a header, so a request with one is refused
  // before Clerk would ask its servers about it. Plain words, never cached.
  if (request.headers.has("authorization")) {
    return new NextResponse("Not signed in.", {
      status: 401,
      headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
    });
  }

  return clerk(request, event);
}

// Which requests the middleware runs for. This is Clerk's recommended matcher:
// every page and API route, but not Next.js internals or static files.
//
// One change from Clerk's version (audit run 2, November 2026): the "$" after
// the list of file endings. Without it, a path that merely CONTAINED ".png"
// or ".css" somewhere (/admin/x.png/anything) counted as a static file and
// skipped the middleware, and with it the sign-in redirect. Now only a path
// that ENDS in one of those endings is skipped, which is what a static file
// is. The pages still check who is signed in themselves either way (see the
// top of this file); this keeps the convenience layer honest.
// lib/proxy-matcher.test.ts checks which paths are matched.
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)$).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
