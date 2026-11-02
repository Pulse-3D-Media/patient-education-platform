import { getCurrentClinicId } from "@/lib/clinic";
import { getShareForClinic } from "@/lib/db/shares";
import { qrPng } from "@/lib/qr";
import { qrOriginFor } from "@/lib/qr-code";
import { isClinicAdmin } from "@/lib/roles";
import { qrFileName, watchLink } from "@/lib/share-link";

/**
 * The QR code for one share link as a PNG image, at /admin/qr/<code>.
 *
 * The admin page shows it as a picture and its Download button saves it.
 * The image is drawn fresh from the code in the address on each request;
 * no image files are stored anywhere.
 *
 * The address in it is fixed on production (PERMANENT_QR_ORIGIN in
 * lib/qr-code.ts). Downloaded from a preview, it opens that test address, and
 * the file's name starts with TEST-ONLY.
 */
export async function GET(request: Request, { params }: RouteContext<"/admin/qr/[code]">) {
  const { code } = await params;

  // Admins only, and only for an open clinic. Anyone else gets a 404 rather
  // than a 401, so the response gives nothing away about which codes exist.
  const clinicId = (await isClinicAdmin()) ? await getCurrentClinicId() : null;
  if (!clinicId) {
    return new Response("No share link has that code.", { status: 404 });
  }

  const share = await getShareForClinic(clinicId, code);
  if (!share) {
    return new Response("No share link has that code.", { status: 404 });
  }

  const where = qrOriginFor(request.headers.get("host"), process.env);
  if (!where) return new Response("This deployment does not know its own address.", { status: 503 });

  const png = await qrPng(watchLink(where.origin, share.code));
  const name = `${where.testOnly ? "TEST-ONLY-" : ""}${qrFileName(share.video.title, share.code)}`;

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="${name}"`,
      // A code never changes, so the browser may keep the picture for an hour.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
