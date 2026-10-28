/**
 * Where pictures on our pages may come from: the one list both the content
 * policy (lib/security-headers.ts, img-src) and the forms that take a picture
 * address (a clinic's logo, a video's poster, a category's tile picture) read.
 *
 * Why a list: the patient page shows a clinic's logo and a video's poster
 * straight from the address saved for it. With "any https address", a typo
 * or a bad paste could make every patient's phone ask some unknown site for
 * a picture (and tell it the phone's address). With the list, the forms
 * refuse an address on any other site, and once the content policy is
 * enforced the browser refuses one too.
 *
 * What is on it, found by reading the testing database and the code in
 * October 2026 (Prompt S):
 *   - the Webflow CDN: the Pulse logo, the starting category pictures, the
 *     finished animations' files and any poster stills cut from them;
 *   - img.clerk.com: every logo a clinic uploads on /admin/branding (it goes
 *     to the clinic's Clerk organization, and Clerk serves it from there),
 *     and the staff's own pictures in Clerk's account menu;
 *   - image.mux.com: the signed stills of videos that have moved to Mux.
 * Our own address is always allowed too.
 *
 * Adding a site is one line here, and it then applies to both the forms and
 * the policy. Pure: no database, safe for the browser.
 */

/** Hosts a picture may come from. "*." means any address under that name (and not the name itself). */
export const PICTURE_HOSTS = ["cdn.prod.website-files.com", "*.website-files.com", "uploads-ssl.webflow.com", "img.clerk.com", "image.mux.com"] as const;

/** The same list as the content policy writes it. */
export const PICTURE_SOURCES: string[] = PICTURE_HOSTS.map((host) => `https://${host}`);

/** Does this host match the list? Exact names, or a name under a "*." entry. */
export function isAllowedPictureHost(host: string): boolean {
  const name = host.toLowerCase();
  return PICTURE_HOSTS.some((entry) => (entry.startsWith("*.") ? name.endsWith(entry.slice(1)) && name.length > entry.length - 1 : name === entry));
}

/** Is this an https address on one of the hosts above? Anything that cannot be read is no. */
export function isAllowedPictureUrl(address: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === "https:" && !url.port && isAllowedPictureHost(url.hostname);
  } catch {
    return false;
  }
}

/** The sentence a form shows for an address on another site. `what` is "logo", "poster" or "tile picture". */
export function pictureHostRefusal(what: string): string {
  return `The ${what} has to be on the Webflow CDN (cdn.prod.website-files.com), Clerk (img.clerk.com) or Mux (image.mux.com). Upload it to the Webflow site's assets and paste that address, or ask for the site to be added.`;
}
