/**
 * Which web address Stripe may send a person back to after checkout.
 *
 * Pure: no request, no database. The caller hands in the request's Host
 * header and the environment, and gets back an origin such as
 * "https://example.vercel.app", or null when none can be trusted.
 *
 * WHY THIS EXISTS. lib/base-url.ts builds links from the Host header of the
 * incoming request, which is fine for a QR code shown to the person who made
 * the request. A return address handed to Stripe is different: the Host
 * header is something the sender of a request chooses, and an address that
 * ends up in a payment flow must not be one an attacker chose. So the Host
 * header is only ever used to PICK among addresses this deployment already
 * knows are its own. It is never trusted by itself.
 *
 * The addresses a deployment knows are its own:
 *
 *   - on Vercel, the ones Vercel itself sets (not the request):
 *     VERCEL_PROJECT_PRODUCTION_URL, VERCEL_BRANCH_URL and VERCEL_URL;
 *   - APP_ORIGINS, an optional comma-separated list for a custom domain
 *     (for instance "https://app.example.com");
 *   - on a developer's own computer only (not on Vercel, and not a
 *     production build), http://localhost and http://127.0.0.1 on any port.
 */

export type OriginEnv = {
  VERCEL?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  APP_ORIGINS?: string;
  NODE_ENV?: string;
};

/** "https://host" from a bare host name Vercel gives, or null when it does not look like one. */
function httpsOrigin(host: string | undefined): string | null {
  const name = host?.trim().toLowerCase();
  if (!name || !/^[a-z0-9.-]+$/.test(name)) return null;
  return `https://${name}`;
}

/** An origin from APP_ORIGINS, checked: https only, a plain host, nothing after it. */
function listedOrigin(text: string): string | null {
  try {
    const url = new URL(text.trim());
    if (url.protocol !== "https:") return null;
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Every origin this deployment knows is its own, most preferred first. */
export function knownOrigins(env: OriginEnv): string[] {
  const origins = [
    ...(env.APP_ORIGINS ?? "").split(",").map(listedOrigin),
    httpsOrigin(env.VERCEL_BRANCH_URL),
    httpsOrigin(env.VERCEL_URL),
    httpsOrigin(env.VERCEL_PROJECT_PRODUCTION_URL),
  ].filter((origin): origin is string => origin !== null);
  return [...new Set(origins)];
}

/** True for localhost or 127.0.0.1, with or without a port. */
function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host);
}

/**
 * The origin to build Stripe's return addresses from.
 *
 *   requestHost   the Host header of the request being answered
 *
 * When the request came in on one of the known origins, that one is used, so
 * a person who started on a preview address comes back to the same preview.
 * Otherwise the first known origin is used. A developer's own computer gets
 * its localhost address. Null means nothing can be trusted, and checkout is
 * refused rather than sent somewhere unknown.
 */
export function pickTrustedOrigin(requestHost: string | null | undefined, env: OriginEnv): string | null {
  const host = (requestHost ?? "").trim().toLowerCase();
  const known = knownOrigins(env);

  const asked = host && /^[a-z0-9.:-]+$/.test(host) ? `https://${host}` : null;
  if (asked && known.includes(asked)) return asked;

  // A developer's computer: not on Vercel, not a production build.
  const local = !env.VERCEL && env.NODE_ENV !== "production";
  if (local && isLocalHost(host)) return `http://${host}`;

  return known[0] ?? null;
}
