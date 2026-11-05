import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { readClerkEvent, readDeliveryId } from "@/lib/clerk-events";
import { handleClerkEvent } from "@/lib/clerk-webhook";
import { errorKind } from "@/lib/error-kind";

/**
 * Where Clerk sends its notifications: POST /api/webhooks/clerk.
 *
 * Public on purpose, like the Stripe and Mux ones next door (proxy.ts hands
 * /api/webhooks on without Clerk's middleware). What stands in for a
 * sign-in is the signature: Clerk signs each delivery with a secret only
 * Clerk and this server hold (CLERK_WEBHOOK_SIGNING_SECRET, from the
 * endpoint's page in the Clerk dashboard), and Clerk's own verifyWebhook
 * checks it, over the exact bytes sent, before anything is read. A request
 * that fails the check is answered 400 and leaves no trace.
 *
 * What the notification is used for: ONLY to learn which clinic to look at,
 * and, for a membership, whose. Then lib/clerk-webhook.ts asks Clerk where
 * things stand now. Read the top of lib/clerk-events.ts for why this exists.
 *
 * What the answers mean to Clerk:
 *
 *   200   finished (something written, nothing to do, or a kind we do not use).
 *   400   not from Clerk, or unreadable. No retry could succeed.
 *   500   the work failed (Clerk or the database unreachable). Clerk sends it
 *         again later.
 *   503   the signing secret is not set on this deployment. Clerk tries again
 *         later, by which time it may be.
 *
 * The work is finished BEFORE answering. Nothing from the body, the headers
 * or an error message is ever logged (the body carries the address and
 * browser of whoever made the change, which we never read), and nothing is
 * returned but a word.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function answer(status: number, word: string) {
  return new Response(word, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim();
  if (!signingSecret) {
    console.error("Clerk webhook: the signing secret is not set on this deployment.");
    return answer(503, "not configured");
  }

  let verified: unknown;
  try {
    verified = await verifyWebhook(request, { signingSecret });
  } catch {
    return answer(400, "bad signature");
  }

  const event = readClerkEvent(verified);
  if (!event) return answer(200, "ignored");

  try {
    await handleClerkEvent(event, readDeliveryId(request.headers.get("svix-id")));
    return answer(200, "ok");
  } catch (error) {
    // The kind only (a Prisma code, the class name): a message could carry an id or an address.
    console.error("Clerk webhook: the work failed.", errorKind(error));
    return answer(500, "failed");
  }
}
