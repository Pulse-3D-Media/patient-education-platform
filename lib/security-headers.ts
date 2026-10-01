/**
 * The security headers every response carries, set once in next.config.ts.
 * Pure: it takes the few settings it depends on and returns the header list,
 * so the tests can read exactly what a deployment sends.
 *
 * What each one is for, in plain words:
 *
 *   Content-Security-Policy        Two rules browsers enforce today: no other
 *                                  site may show our pages inside a frame of
 *                                  its own (so a look-alike page cannot wrap
 *                                  the patient page or the sign-in page and
 *                                  trick someone into tapping), and no old
 *                                  plug-in content or <base> trick.
 *   Content-Security-Policy-       The full list of where scripts, styles,
 *     Report-Only                  pictures, video and connections may come
 *                                  from. "Report only" means the browser
 *                                  BLOCKS NOTHING: it only writes a line in
 *                                  its own console when something would have
 *                                  been blocked. Clerk loads its sign-in
 *                                  script and its bot check from addresses of
 *                                  its own, and a strict list that missed one
 *                                  would lock every staff member out, so the
 *                                  list is tried this way first. Turning it
 *                                  on is one word (see CSP_ENFORCED below).
 *   X-Frame-Options                The older spelling of "no framing", for
 *                                  browsers that do not read the policy.
 *   Referrer-Policy                When a page asks another site for
 *                                  something (Clerk, the video CDN, a clinic's
 *                                  logo), that site is told only our address,
 *                                  never the page's path. On the patient page
 *                                  the path holds the link's code, so the code
 *                                  never leaves for another site.
 *   Strict-Transport-Security      Browsers that have visited once only ever
 *                                  use https for this address afterwards.
 *   X-Content-Type-Options         A file is treated only as what we say it
 *                                  is, never guessed into something runnable.
 *   Permissions-Policy             No page here may ask for the camera, the
 *                                  microphone or the location. Full screen
 *                                  and picture-in-picture stay allowed.
 *
 * None of this is copy protection: it does not stop a screenshot, a screen
 * recording or someone saving the video file. See "The video boundary" in
 * CLAUDE.md.
 */

export type Header = { key: string; value: string };

export type SecurityHeaderSettings = {
  /** NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: it names the address Clerk's script comes from. */
  clerkPublishableKey?: string;
  /** VERCEL_ENV: "preview" adds Vercel's own comment toolbar, which only previews show. */
  vercelEnv?: string;
  /** True under `next dev`, whose hot reload needs to run code the policy would otherwise refuse. */
  dev?: boolean;
};

/**
 * Whether the full list is enforced. False while it is being tried: the
 * browser reports what it would block and blocks nothing. Set to true once
 * sign-in, the library, the patient page and checkout have been clicked
 * through on a preview with no report in the browser's console.
 */
export const CSP_ENFORCED = false;

/** Where the finished animations, posters and the Pulse logo are served from today. */
const WEBFLOW_CDN = ["https://cdn.prod.website-files.com", "https://*.website-files.com", "https://uploads-ssl.webflow.com"];

/** Clerk's bot check (Cloudflare Turnstile) and its newer protection service, both shown on sign-up. */
const CLERK_CHALLENGES = ["https://challenges.cloudflare.com", "https://*.protect.clerk.com"];

/** Used when the key is missing or unreadable: every Clerk development instance lives under this name. */
const CLERK_FALLBACK = "https://*.clerk.accounts.dev";

/**
 * The address Clerk serves its script and its sign-in calls from. A Clerk
 * publishable key is "pk_test_" or "pk_live_" followed by that address in
 * base64 with a "$" on the end; it is public by design (it is in every staff
 * page). Anything that does not decode to a plain host name gives the
 * fallback, never a guess.
 */
export function clerkFrontendOrigin(publishableKey: string | undefined): string {
  const match = /^pk_(?:test|live)_([A-Za-z0-9+/=_-]+)$/.exec(publishableKey ?? "");
  if (!match) return CLERK_FALLBACK;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const host = decoded.endsWith("$") ? decoded.slice(0, -1) : "";
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) return CLERK_FALLBACK;
  return `https://${host.toLowerCase()}`;
}

/** The three rules enforced today. Safe for every page: nothing here frames, embeds a plug-in or rewrites <base>. */
const ENFORCED_POLICY = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'";

/** The full list: where everything on our pages may come from. */
export function contentSecurityPolicy(settings: SecurityHeaderSettings): string {
  const clerk = clerkFrontendOrigin(settings.clerkPublishableKey);
  const preview = settings.vercelEnv === "preview";

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-inline' because Next.js puts small scripts in the page itself
    // to start React; allowing them by a per-request number (a nonce) would
    // make every page dynamic, which the speed rule does not allow on the
    // patient page. 'unsafe-eval' is for `next dev` only.
    "script-src": ["'self'", "'unsafe-inline'", ...(settings.dev ? ["'unsafe-eval'"] : []), clerk, ...CLERK_CHALLENGES, ...(preview ? ["https://vercel.live"] : [])],
    "style-src": ["'self'", "'unsafe-inline'", ...(preview ? ["https://vercel.live"] : [])],
    // Pictures may come from any https address: a clinic's logo is an
    // address Pulse staff approve, on whatever site the clinic keeps it.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "media-src": ["'self'", "blob:", ...WEBFLOW_CDN],
    // Our fonts are served from our own address (app/brand-fonts.ts).
    "font-src": ["'self'", "data:", ...(preview ? ["https://vercel.live", "https://assets.vercel.com"] : [])],
    "connect-src": [
      "'self'",
      clerk,
      "https://clerk-telemetry.com",
      "https://*.clerk-telemetry.com",
      "https://img.clerk.com",
      ...CLERK_CHALLENGES,
      ...(preview ? ["https://vercel.live", "wss://ws-us3.pusher.com"] : []),
    ],
    "frame-src": ["'self'", ...CLERK_CHALLENGES, ...(preview ? ["https://vercel.live"] : [])],
    "worker-src": ["'self'", "blob:"],
    // Checkout leaves for Stripe by a plain page change, not a form, so no
    // form on our pages needs to send anywhere but here.
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

export function securityHeaders(settings: SecurityHeaderSettings): Header[] {
  const full = contentSecurityPolicy(settings);
  return [
    CSP_ENFORCED
      ? { key: "Content-Security-Policy", value: full }
      : { key: "Content-Security-Policy", value: ENFORCED_POLICY },
    ...(CSP_ENFORCED ? [] : [{ key: "Content-Security-Policy-Report-Only", value: full }]),
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Two years, the usual value. Not "preload": that is a list kept by the
    // browsers themselves and is very hard to leave, so it is a decision for
    // when the app has its own pulse3dmedia.com address.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
}
