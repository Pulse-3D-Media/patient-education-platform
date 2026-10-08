import { EDUCATION_ONLY } from "@/lib/education-note";

/**
 * The printed pamphlet, shared by a one-time patient link's pamphlet
 * (/admin/print/<code>) and a printed QR code's (/admin/qr-codes/<id>), so the
 * two always look alike on paper.
 *
 * Print rules. Sizes are in inches because that is what paper is measured
 * in. The @page rule asks for US Letter with no printer margin, and the
 * pamphlet keeps half an inch of its own space inside, so nothing sits at
 * the paper's edge.
 */
export const PRINT_CSS = `
  @page { size: 8.5in 11in; margin: 0; }
  .sheet { width: 8.5in; height: 11in; position: relative; }
  .pamphlet { height: 5.5in; padding: 0.5in; }
  .cut-line { position: absolute; top: 5.5in; left: 0; right: 0; border-top: 1px dashed #98a2b3; }
  @media print { html, body { background: white; } }
`;

/**
 * One half-page pamphlet: 8.5 by 5.5 inches. The placeholder line and the
 * test line are plain dark text in a bordered box, not a coloured fill, so
 * they survive a black-and-white printer.
 */
export function Pamphlet({
  title,
  from,
  placeholder,
  link,
  qrImage,
  testOnly = false,
}: {
  title: string;
  from: string[];
  placeholder: boolean;
  link: string;
  qrImage: string;
  /** Printed from a preview or a developer's computer: the paper says so in large letters, so it is never handed to a patient. */
  testOnly?: boolean;
}) {
  return (
    <section className="pamphlet flex items-center gap-[0.5in]">
      <div className="min-w-0 flex-1">
        {testOnly && (
          <p className="mb-[0.15in] inline-block border-[3px] border-black px-[0.1in] py-[0.03in] text-[12pt] font-bold uppercase tracking-wider">
            Test only: not for patients
          </p>
        )}
        {placeholder && (
          <p className="mb-[0.15in] inline-block border-2 border-black px-[0.1in] py-[0.03in] text-[10pt] font-bold uppercase tracking-wider">
            Placeholder: plays a sample animation, not this procedure
          </p>
        )}
        <p className="text-[11pt] font-medium uppercase tracking-wider text-[#667085]">Your procedure</p>
        <h1 className="mt-[0.1in] text-[26pt] font-semibold leading-tight">{title}</h1>
        <p className="mt-[0.08in] text-[12pt] font-medium">
          {from.map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </p>
        <p className="mt-[0.3in] text-[13pt] leading-snug">
          Scan this code with your phone&rsquo;s camera to watch a short animation about your procedure.
        </p>
        <p className="mt-[0.2in] text-[10pt] leading-snug break-all text-[#667085]">
          Or type this address into your phone: <span className="text-black">{link}</span>
        </p>
        {/* The same sentence as under the video on the patient page. Plain dark text, so it survives any printer. */}
        <p className="mt-[0.15in] text-[11.5pt] leading-snug text-[#344054]">{EDUCATION_ONLY}</p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- a drawn QR code, not a photo to resize */}
      <img src={qrImage} alt={`QR code that opens ${link}`} className="h-[2.6in] w-[2.6in] shrink-0" />
    </section>
  );
}
