import { MuxConfigError, getMuxWebhookSecret, verifyMuxWebhook } from "@/lib/mux";
import { isHandledMuxEvent, readMuxEvent } from "@/lib/mux-upload";
import { reconcileUpload } from "@/lib/mux-uploads";

/**
 * Where Mux sends its notifications: POST /api/webhooks/mux.
 *
 * Public on purpose, like the Stripe one next door (proxy.ts leaves
 * /api/webhooks alone). What stands in for a sign-in is the signature: Mux
 * signs the exact bytes it sends with a secret only Mux and this server
 * hold, and nothing is read, stored or done until that signature has been
 * checked (verifyMuxWebhook in lib/mux.ts). A request that fails the check
 * is answered 400 and leaves no trace.
 *
 * What the notification is used for: ONLY to learn which upload to look at.
 * Two facts are read from the body, its kind and the upload's id, and then
 * reconcileUpload() (lib/mux-uploads.ts) asks Mux where that upload stands
 * now and applies that. So a repeated notification, two arriving out of
 * order, or one about an upload a staff member has since replaced all end
 * in the same row, and nothing Mux says in the body is ever believed on its
 * own. The same function sits behind the "Check with Mux" button.
 *
 * What the answers mean to Mux:
 *
 *   200   finished (done, nothing to do, or a kind we do not use).
 *   400   not from Mux, or unreadable. No retry could succeed.
 *   500   the work failed (Mux or the database unreachable). Mux sends it
 *         again later.
 *   503   the signing secret is not set on this deployment. Mux tries again
 *         later, by which time it may be.
 *
 * The work is finished BEFORE answering: a serverless function may be
 * stopped as soon as it has answered. Nothing from the body is ever logged,
 * and nothing is returned but a word.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function answer(status: number, word: string) {
  return new Response(word, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  let secret: string;
  try {
    secret = getMuxWebhookSecret();
  } catch (error) {
    if (error instanceof MuxConfigError) {
      console.error("Mux webhook: the signing secret is not set on this deployment.");
      return answer(503, "not configured");
    }
    throw error;
  }

  // The body exactly as sent: the signature is over the original bytes.
  const rawBody = await request.text();

  let body: unknown;
  try {
    body = verifyMuxWebhook(rawBody, request.headers.get("mux-signature"), secret);
  } catch {
    return answer(400, "bad signature");
  }

  const event = readMuxEvent(body);
  if (!event || !isHandledMuxEvent(event.type)) return answer(200, "ignored");
  if (!event.uploadId) return answer(200, "ignored");

  try {
    await reconcileUpload(event.uploadId);
    return answer(200, "ok");
  } catch (error) {
    // The kind only (a Prisma code, the class name): a message could carry an address.
    console.error("Mux webhook: the work failed.", error instanceof Error ? error.name : "unknown error");
    return answer(500, "failed");
  }
}
