import Link from "next/link";
import { notFound } from "next/navigation";
import { getBaseUrl } from "@/lib/base-url";
import { getCurrentClinicId } from "@/lib/clinic";
import { getShareForClinic } from "@/lib/db/shares";
import { qrSvg } from "@/lib/qr";
import { watchLink } from "@/lib/share-link";
import { PrintButton } from "./PrintButton";

/**
 * A printable pamphlet for one share link, at /admin/print/<code>.
 *
 * On screen: a preview of the sheet with a Print button. On paper: one US
 * Letter sheet (8.5 by 11 inches) carrying the pamphlet twice, one per half,
 * with a dashed line to cut along, so one sheet makes two pamphlets.
 *
 * Each half-page pamphlet has the procedure name, the QR code, one line of
 * instructions (plus the typed-out link for anyone who cannot scan), and the
 * Pulse 3D logo on a black band, which prints fine in black and white.
 */
export const dynamic = "force-dynamic";

// Same logo as the library banner. It is light, so it sits on a black band.
const LOGO = "https://cdn.prod.website-files.com/69092ab4b2ae593d551bb95f/6a394f4daad9a6c8cc1d16a4_pulse3dmedia-logo-p-500.png";

/**
 * Print rules. Sizes are in inches because that is what paper is measured
 * in. The @page rule asks for US Letter with no printer margin, and the
 * pamphlet keeps half an inch of its own space inside, so nothing sits at
 * the paper's edge.
 */
const PRINT_CSS = `
  @page { size: 8.5in 11in; margin: 0; }
  .sheet { width: 8.5in; height: 11in; position: relative; }
  .pamphlet { height: 5.5in; padding: 0.5in; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cut-line { position: absolute; top: 5.5in; left: 0; right: 0; border-top: 1px dashed #98a2b3; }
  @media print { html, body { background: white; } }
`;

export default async function PrintPage({ params }: PageProps<"/admin/print/[code]">) {
  const { code } = await params;

  const clinicId = getCurrentClinicId();
  if (!clinicId) notFound();

  const share = await getShareForClinic(clinicId, code);
  if (!share) notFound();

  const link = watchLink(await getBaseUrl(), share.code);
  // The QR code as a picture the browser can show: SVG, so it prints sharp.
  const qrImage = "data:image/svg+xml;utf8," + encodeURIComponent(await qrSvg(link));

  return (
    <div className="min-h-screen bg-[#e4ebf3] text-black print:bg-white">
      <style>{PRINT_CSS}</style>

      {/* Toolbar: on screen only, never on paper */}
      <div className="mx-auto flex w-[8.5in] items-center justify-between py-4 print:hidden">
        <Link href="/admin" className="text-sm font-medium text-[#1e5668] hover:underline">
          Back to share links
        </Link>
        <PrintButton />
      </div>

      {/* The sheet of paper: the pamphlet twice, one per half */}
      <div className="sheet mx-auto bg-white shadow-[0_8px_40px_rgba(0,0,0,.15)] print:shadow-none">
        <Pamphlet title={share.video.title} link={link} qrImage={qrImage} />
        <div className="cut-line" aria-hidden="true" />
        <Pamphlet title={share.video.title} link={link} qrImage={qrImage} />
      </div>

      <p className="py-4 text-center text-sm text-[#667085] print:hidden">
        Prints on US Letter. Cut along the dashed line for two pamphlets.
      </p>
    </div>
  );
}

/** One half-page pamphlet: 8.5 by 5.5 inches. */
function Pamphlet({ title, link, qrImage }: { title: string; link: string; qrImage: string }) {
  return (
    <section className="pamphlet flex flex-col">
      <div className="flex flex-1 items-center gap-[0.5in]">
        <div className="min-w-0 flex-1">
          <p className="text-[11pt] font-medium uppercase tracking-wider text-[#667085]">Your procedure</p>
          <h1 className="mt-[0.1in] text-[26pt] font-semibold leading-tight">{title}</h1>
          <p className="mt-[0.3in] text-[13pt] leading-snug">
            Scan this code with your phone&rsquo;s camera to watch a short animation about your procedure.
          </p>
          <p className="mt-[0.2in] text-[10pt] leading-snug text-[#667085]">
            Or type this address into your phone: <span className="text-black">{link}</span>
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- a drawn QR code, not a photo to resize */}
        <img src={qrImage} alt={`QR code that opens ${link}`} className="h-[2.6in] w-[2.6in] shrink-0" />
      </div>

      <div className="flex h-[0.6in] shrink-0 items-center rounded-md bg-black px-[0.3in]">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
        <img src={LOGO} alt="Pulse 3D" className="h-[0.28in] w-auto" />
      </div>
    </section>
  );
}
