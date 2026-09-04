import { headers } from "next/headers";

/**
 * The address this site is being viewed at, such as https://example.com,
 * so links and QR codes point back at the same site (local, preview or live)
 * without a setting to keep in sync. Vercel sets x-forwarded-proto.
 *
 * Server only: it reads the incoming request's headers.
 */
export async function getBaseUrl() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}
