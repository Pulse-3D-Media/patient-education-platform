import { getCurrentClinicId } from "@/lib/clinic";
import { getLiveQrCodeForClinic } from "@/lib/db/qr-codes";
import { qrPng } from "@/lib/qr";
import { printedQrFileName, qrLink, qrOriginFor } from "@/lib/qr-code";
import { isClinicAdmin } from "@/lib/roles";

/**
 * A printed (permanent) QR code as a PNG picture, at /admin/qr-codes/<id>/image,
 * for the office to put on its own handouts, posters or intake packets. The
 * same code every time it is downloaded. Drawn fresh on each request; no
 * image is stored anywhere.
 *
 * The address in it is fixed on production (PERMANENT_QR_ORIGIN in
 * lib/qr-code.ts). Downloaded from a preview, it opens that test address, and
 * the file's name starts with TEST-ONLY.
 *
 * Admins of an open clinic only, and only this clinic's live codes. Anyone
 * else, another clinic's id and a retired code get a plain 404 that gives
 * nothing away.
 */
export async function GET(request: Request, { params }: RouteContext<"/admin/qr-codes/[id]/image">) {
  const { id } = await params;
  const clinicId = (await isClinicAdmin()) ? await getCurrentClinicId() : null;
  const qr = clinicId ? await getLiveQrCodeForClinic(clinicId, id) : null;
  if (!qr) return new Response("No printed code has that id.", { status: 404 });

  const where = qrOriginFor(request.headers.get("host"), process.env);
  if (!where) return new Response("This deployment does not know its own address.", { status: 503 });

  const png = await qrPng(qrLink(where.origin, qr.code));
  const name = `${where.testOnly ? "TEST-ONLY-" : ""}${printedQrFileName(qr.video.title, qr.id)}`;
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${name}"`,
      // Never kept: a retired code must not come back out of a cache.
      "Cache-Control": "private, no-store",
    },
  });
}
