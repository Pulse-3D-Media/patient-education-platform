"use client";

import { PLACEHOLDER_BADGE, SECONDARY_BUTTON } from "@/components/ui/styles";
import { ConfirmButton } from "../people/ConfirmButton";
import { replaceQrCodeAction, retireQrCodeAction } from "./actions";

/** One live printed code, as the list shows it. Dates arrive already in words. */
export type PrintedCodeItem = {
  id: string;
  videoTitle: string;
  isPlaceholder: boolean;
  isPublished: boolean;
  surgeonName: string | null;
  /** False once the surgeon holds no seat here: the code still works, but its new links name only the clinic. */
  surgeonSeated: boolean;
  madeOn: string;
};

/**
 * "Printed QR codes" on /admin/links: this clinic's live permanent codes, the
 * only links an office ever needs to find again, because a printed code has
 * to be retirable. Bounded: the page reads at most a hundred
 * (listLiveQrCodesForClinic) and says so when there are more.
 *
 * Each row: the procedure, the surgeon, when it was made, and Print,
 * Download, Replace and Retire. Retire and Replace each ask first, because
 * every copy of the code stops working at once, wherever it was printed. A
 * code whose surgeon no longer holds a seat is marked as needing attention:
 * it still works, and its new links name only the clinic (decided by Evan on
 * 2026-10-08); Replace is not offered for it, because a new code would be in
 * that surgeon's name.
 *
 * No numbers about how often a code is used: clinics do not see usage yet
 * (decided by Evan on 2026-10-07). Pulse staff see them on the clinic's page.
 */
export function PrintedCodes({ codes, total }: { codes: PrintedCodeItem[]; total: number }) {
  return (
    <section id="printed-codes" aria-labelledby="printed-heading" className="mt-12 scroll-mt-6">
      <h2 id="printed-heading" className="text-lg font-semibold">
        Printed QR codes
        {total > 0 && <span className="ml-2 text-base font-normal text-ink-muted">{total}</span>}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-soft">
        A printed code goes on a pamphlet, a poster or your own handouts and does not run out. Every patient who scans it gets a link of their own,
        which works like any other link. Retire a code to stop every printed copy of it at once; links it already gave patients keep working.
        Make one with Printed QR code on a procedure above.
      </p>

      {codes.length === 0 ? (
        <p className="mt-3 text-ink-soft">No printed codes yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {codes.map((code) => (
            <li
              key={code.id}
              className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 lg:flex-row lg:items-start lg:justify-between"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                  {code.videoTitle}
                  {code.isPlaceholder && <span className={PLACEHOLDER_BADGE}>Placeholder</span>}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  {code.surgeonName ? `Surgeon: ${code.surgeonName}` : "Surgeon: no name set"} &middot; Made {code.madeOn}
                </p>
                {!code.surgeonSeated && (
                  <p className="mt-2 max-w-xl text-sm text-warn">
                    Needs a look: {code.surgeonName ?? "this surgeon"} no longer holds a seat. The code still works, but the links it gives patients
                    now name only the clinic. Retire it, and make a new one from a surgeon who holds a seat.
                  </p>
                )}
                {!code.isPublished && (
                  <p className="mt-2 max-w-xl text-sm text-warn">
                    This video is not available right now, so the code gives patients nothing until it is back.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <a href={`/admin/qr-codes/${code.id}`} target="_blank" rel="noopener" className={SECONDARY_BUTTON}>
                  Print
                </a>
                <a href={`/admin/qr-codes/${code.id}/image`} download className={SECONDARY_BUTTON}>
                  Download
                </a>
                {code.surgeonSeated && (
                  <ConfirmButton
                    label="Replace"
                    title="Replace this printed code?"
                    body={
                      <>
                        <p>
                          A new code is made for {code.videoTitle}
                          {code.surgeonName ? `, from ${code.surgeonName}` : ""}, and the old one stops working on every copy that was printed or
                          downloaded.
                        </p>
                        <p className="mt-3">Links it already gave patients keep working. You will need to print the new code.</p>
                      </>
                    }
                    yes="Yes, replace it"
                    action={() => replaceQrCodeAction(code.id)}
                  />
                )}
                <ConfirmButton
                  label="Retire"
                  title="Retire this printed code?"
                  body={
                    <>
                      <p>
                        The code for {code.videoTitle} stops working on every copy that was printed or downloaded. This cannot be undone; you can make
                        a new code instead.
                      </p>
                      <p className="mt-3">Links it already gave patients keep working.</p>
                    </>
                  }
                  yes="Yes, retire it"
                  danger
                  action={() => retireQrCodeAction(code.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {total > codes.length && (
        <p className="mt-3 text-sm text-ink-muted">
          Showing the newest {codes.length} of {total}. Retire codes you no longer use to see the rest.
        </p>
      )}
    </section>
  );
}
