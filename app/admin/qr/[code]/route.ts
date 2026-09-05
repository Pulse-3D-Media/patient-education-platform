import { getBaseUrl } from "@/lib/base-url";
import { getCurrentClinicId } from "@/lib/clinic";
import { getShareForClinic } from "@/lib/db/shares";
import { qrPng } from "@/lib/qr";
import { qrFileName, watchLink } from "@/lib/share-link";

/**
 * The QR code for one share link as a PNG image, at /admin/qr/<code>.
 *
 * The admin page shows it as a picture and its Download button saves it.
 * The image is drawn fresh from the code in the address on each request;
 * no image files are stored anywhere.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/qr/[code]">) {
  const { code } = await params;

  const clinicId = getCurrentClinicId();
  if (!clinicId) {
    return new Response("CLINIC_ID is not set.", { status: 500 });
  }

  const share = await getShareForClinic(clinicId, code);
  if (!share) {
    return new Response("No share link has that code.", { status: 404 });
  }

  const png = await qrPng(watchLink(await getBaseUrl(), share.code));

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="${qrFileName(share.video.title, share.code)}"`,
      // A code never changes, so the browser may keep the picture for an hour.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
