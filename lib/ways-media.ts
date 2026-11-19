/**
 * The pictures and the one short video the landing page's "three ways"
 * section shows (components/landing/WaysSection.tsx). They are the Pulse 3D
 * website's own files, already public on pulse3dmedia.com/earlyaccess, served
 * from the Webflow CDN. Nothing is copied into this repository.
 *
 * The content policy already allows the Webflow CDN for pictures
 * (PICTURE_HOSTS in lib/picture-hosts.ts) and for video (media-src in
 * lib/security-headers.ts), so the page needed no change to it;
 * lib/ways-media.test.ts fails if one of these ever points somewhere the
 * policy does not allow.
 */

const CDN = "https://cdn.prod.website-files.com/69092ab4b2ae593d551bb95f";

export const WAYS_MEDIA = {
  /** The Pulse 3D mark drawn inside the tablet and the patient page. */
  logo: `${CDN}/6aebc77ee658183ad82c918c_ea-logo.webp`,
  /** The round "3D" badge on the video. */
  badge: `${CDN}/6aebc727202a29e0b9b5685f_ea-badge-3d.webp`,
  /** The still shown before the video plays, and if it never does. */
  poster: `${CDN}/6aebc77dd895d6584ef86a7c_ea-knee-still.webp`,
  /** The short, silent knee clip (640 wide, H.264), played only while it is on screen. */
  video: `${CDN}/6aebc727c206ee372e2be9b0_ea-knee-640.mp4`,
  /** The picture in the text message, and the tablet's small thumbnail. */
  still4: `${CDN}/6aebc7b50f4aaaccbec64f27_ea-still-4.webp`,
  /** The "More in Knee" thumbnails on the tablet. */
  still2: `${CDN}/6aebc7b29602c07ac15531b8_ea-still-2.webp`,
  still3: `${CDN}/6aebc7b2e58ff73a8f05955e_ea-still-3.webp`,
  still5: `${CDN}/6aebc7b737759af8ecea568e_ea-still-5.webp`,
} as const;

/**
 * The made-up QR code on the printed card: the website's own pattern (the
 * three corner squares, and a fixed scatter of dots from the same seeded
 * sequence its script uses), worked out once. It encodes nothing, so a
 * phone that scans the picture opens nothing.
 */
export function decorativeQrPath(): string {
  const finder = (x: number, y: number) => x >= 0 && x < 7 && y >= 0 && y < 7 && (x === 0 || x === 6 || y === 0 || y === 6 || (x > 1 && x < 5 && y > 1 && y < 5));
  const inCorner = (x: number, y: number) => (x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16);
  let seed = 7;
  const next = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  let path = "";
  for (let y = 0; y < 25; y++) {
    for (let x = 0; x < 25; x++) {
      const on = inCorner(x, y) ? finder(x, y) || finder(x - 18, y) || finder(x, y - 18) : next() > 0.52;
      if (on) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return path;
}
