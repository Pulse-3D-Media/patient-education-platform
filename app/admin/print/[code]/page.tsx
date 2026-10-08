import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBaseUrl } from "@/lib/base-url";
import { getCurrentClinicId } from "@/lib/clinic";
import { getShareForClinic } from "@/lib/db/shares";
import { qrSvg } from "@/lib/qr";
import { senderLines } from "@/lib/sender-name";
import { isClinicAdmin } from "@/lib/roles";
import { watchLink } from "@/lib/share-link";
import { Pamphlet, PRINT_CSS } from "../Pamphlet";
import { PrintButton } from "./PrintButton";

/**
 * A printable pamphlet for one share link, at /admin/print/<code>.
 *
 * On screen: a preview of the sheet with a Print button. On paper: one US
 * Letter sheet (8.5 by 11 inches) carrying the pamphlet twice, one per half,
 * with a dashed line to cut along, so one sheet makes two pamphlets.
 *
 * Each half-page pamphlet has the procedure name, who sent it ("Dr. Jane
 * Smith, DO" with "Summit Orthopedics" on the line under it, the same as the
 * patient page, or "From Summit Orthopedics" for a link made before surgeons
 * were recorded), the QR code, and one line of
 * instructions (plus the typed-out link for anyone who cannot scan), and the
 * same "for education only" sentence the patient page carries. A
 * placeholder video carries its mark on the paper too, so a pamphlet for a
 * sample animation can never pass for the real one.
 */
export const dynamic = "force-dynamic";

export default async function PrintPage({ params }: PageProps<"/admin/print/[code]">) {
  const { code } = await params;

  // Signed out: Clerk sends them to sign in and back here afterwards.
  await auth.protect();

  // Admins only, and only for an open clinic. Anyone else gets a plain
  // not-found, which also gives nothing away about which codes exist.
  if (!(await isClinicAdmin())) notFound();
  const clinicId = await getCurrentClinicId();
  if (!clinicId) notFound();

  const share = await getShareForClinic(clinicId, code);
  if (!share) notFound();

  const link = watchLink(await getBaseUrl(), share.code);
  // The QR code as a picture the browser can show: SVG, so it prints sharp.
  const qrImage = "data:image/svg+xml;utf8," + encodeURIComponent(await qrSvg(link));
  const pamphlet = {
    title: share.video.title,
    from: senderLines(share.senderName, share.clinic.name),
    placeholder: share.video.isPlaceholder,
    link,
    qrImage,
  };

  return (
    <div className="min-h-screen bg-[#e4ebf3] text-black print:bg-white">
      <style>{PRINT_CSS}</style>

      {/* Toolbar: on screen only, never on paper */}
      <div className="mx-auto flex w-[8.5in] items-center justify-between py-4 print:hidden">
        <Link href="/admin/links" className="text-sm font-medium text-[#1e5668] hover:underline">
          Back to shared links
        </Link>
        <PrintButton />
      </div>

      {/* The sheet of paper: the pamphlet twice, one per half */}
      <div className="sheet mx-auto bg-white shadow-[0_8px_40px_rgba(0,0,0,.15)] print:shadow-none">
        <Pamphlet {...pamphlet} />
        <div className="cut-line" aria-hidden="true" />
        <Pamphlet {...pamphlet} />
      </div>

      <p className="py-4 text-center text-sm text-[#667085] print:hidden">
        Prints on US Letter. Cut along the dashed line for two pamphlets.
      </p>
    </div>
  );
}
