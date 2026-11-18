/**
 * The address of the demo site, for the "Open demo site" link Pulse staff see
 * at the top of every /pulse page.
 *
 * The demo site is a second copy of the app at a steady address (planned:
 * demo.pulse3dmedia.com) that runs on Stripe's test key, Clerk's test
 * sign-in and the Neon testing database, so a sales call can show a clinic and
 * walk a lead through signing up and paying with Stripe's test card without
 * touching a real clinic. The live site only links to it.
 *
 * The address comes from DEMO_SITE_URL, set in Vercel for Production (and in
 * .env on a computer that wants the link). It is read on the server only,
 * never from anything the browser sent. It must be a plain https address:
 * anything else (empty, not an address, http, a user name or password in it)
 * counts as not set, and then the link is simply not drawn.
 *
 * Pure: no imports, nothing secret. Only ever called by app/pulse/layout.tsx,
 * which has already checked the visitor is Pulse staff.
 */
export function demoSiteUrl(env: Record<string, string | undefined> = process.env): string | null {
  const text = env.DEMO_SITE_URL?.trim();
  if (!text) return null;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  // A user name or password in a link is never what was meant, and would be shown to anyone who hovers it.
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  return url.href;
}
