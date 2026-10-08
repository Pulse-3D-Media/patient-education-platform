import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentClinicId } from "@/lib/clinic";
import { getLiveQrCodeForClinic } from "@/lib/db/qr-codes";
import { qrSvg } from "@/lib/qr";
import { qrLink, qrOriginFor } from "@/lib/qr-code";
import { isClinicAdmin } from "@/lib/roles";
import { senderLines } from "@/lib/sender-name";
import { Pamphlet, PRINT_CSS } from "../../print/Pamphlet";
import { PrintButton } from "../../print/[code]/PrintButton";

/**
 * The printable pamphlet for one PRINTED (permanent) QR code, at
 * /admin/qr-codes/<id>: the same sheet as a one-time link's pamphlet (two
 * half-page pamphlets on US Letter), carrying the printed code's address
 * instead. Print it as many times as you like; it is the same code each time.
 *
 * The address in the code is fixed on the production deployment
 * (PERMANENT_QR_ORIGIN in lib/qr-code.ts), never taken from the request, so
 * paper printed today keeps working. Printed from a preview or a developer's
 * computer, the code opens that test address instead, and the page and the
 * paper both say "Test only" in large letters.
 *
 * Admins of an open clinic only, and only this clinic's live codes, by the
 * code's row id (the code itself is never in this page's address). Anyone
 * else, another clinic's id, and a retired code all get a plain not-found.
 */
export const dynamic = "force-dynamic";

export default async function PrintedCodePamphletPage({ params }: PageProps<"/admin/qr-codes/[id]">) {
  const { id } = await params;
  await auth.protect();
  if (!(await isClinicAdmin())) notFound();
  const clinicId = await getCurrentClinicId();
  if (!clinicId) notFound();

  const qr = await getLiveQrCodeForClinic(clinicId, id);
  if (!qr) notFound();

  const where = qrOriginFor((await headers()).get("host"), process.env);
  if (!where) {
    return (
      <p className="p-8 text-black">This deployment does not know its own address, so no code can be drawn here. Ask Pulse 3D.</p>
    );
  }

  const link = qrLink(where.origin, qr.code);
  const qrImage = "data:image/svg+xml;utf8," + encodeURIComponent(await qrSvg(link));
  const pamphlet = {
    title: qr.video.title,
    // The surgeon while they hold a seat here, else only the clinic: the same as the links the code hands out.
    from: senderLines(qr.surgeonName, qr.clinic.name),
    placeholder: qr.video.isPlaceholder,
    link,
    qrImage,
    testOnly: where.testOnly,
  };

  return (
    <div className="min-h-screen bg-[#e4ebf3] text-black print:bg-white">
      <style>{PRINT_CSS}</style>

      {/* Toolbar: on screen only, never on paper */}
      <div className="mx-auto flex w-[8.5in] items-center justify-between py-4 print:hidden">
        <Link href="/admin/links#printed-codes" className="text-sm font-medium text-[#1e5668] hover:underline">
          Back to shared links
        </Link>
        <PrintButton />
      </div>
      {where.testOnly && (
        <p className="mx-auto mb-4 w-[8.5in] border-2 border-black bg-white p-3 text-sm font-semibold print:hidden">
          Test only. This code opens a test copy of the app, not the real one. Never hand it to a patient; print the real code from the live site.
        </p>
      )}

      <div className="sheet mx-auto bg-white shadow-[0_8px_40px_rgba(0,0,0,.15)] print:shadow-none">
        <Pamphlet {...pamphlet} />
        <div className="cut-line" aria-hidden="true" />
        <Pamphlet {...pamphlet} />
      </div>

      <p className="py-4 text-center text-sm text-[#667085] print:hidden">
        Prints on US Letter. Cut along the dashed line for two pamphlets. This code does not run out: print it as often as you like.
      </p>
    </div>
  );
}
