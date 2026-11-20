"use client";

import { useRef, useState, type FormEvent } from "react";
import { CloseIcon, CopyIcon, PrinterIcon, QrIcon } from "@/components/ui/icons";
import { PatientMessageButtons } from "@/components/ui/PatientMessageButtons";
import { useModalFocus } from "@/components/ui/useModalFocus";
import { patientMessage } from "@/lib/patient-message";
import { INPUT, LABEL } from "@/components/ui/styles";
import type { Sender } from "@/lib/sender-name";
import { watchLink } from "@/lib/share-link";
import { ConfirmButton } from "../people/ConfirmButton";
import { createLinkAction, createQrCodeAction, replaceQrCodeAction, retireQrCodeAction } from "./actions";

/**
 * The forms and buttons on Shared links (/admin/links), from the approved
 * design (screen 09):
 *
 *   - NewLinkForm: "New patient link". Pick a procedure and the doctor it is
 *     from, press Create link, and the new link appears with its QR code and
 *     Copy, QR on screen, Print and Download.
 *   - NewCodeForm: "New printed code". The same two picks, then Make printed
 *     code: the permanent code for that procedure from that doctor (or the
 *     one already live for them), with Print and Download.
 *   - CodeActions: Print, Download, Replace and Retire on one printed code.
 *
 * EVERY LINK IS FROM A DOCTOR, CHOSEN FOR THAT LINK, NOTHING PICKED IN
 * ADVANCE (decided by Evan on 2026-09-25; the mock-up drew a doctor already
 * chosen, and this rule wins). The dropdown lists the people holding a seat;
 * the server checks the choice again when the link is made (lib/senders.ts
 * and createShare), so the dropdown is a courtesy, not the check.
 *
 * WHEN SOMETHING GOES WRONG the picks stay as they were, a plain sentence
 * says what happened, and pressing the button again tries again. Each press
 * of Create link makes a new link; one that is never sent stops on its own.
 *
 * Client components because the picks, the waiting and the answer are state.
 */

/** One video this clinic may share, as the forms list it. */
export type ProcedureChoice = {
  id: string;
  title: string;
  categoryLabel: string; // "Knee", "Foot & Ankle"
  isPlaceholder: boolean;
};

/** What a link or code can be made from, worked out by the page. `blocked` says why nothing can be made right now, if so. */
type Choices = {
  procedures: ProcedureChoice[];
  senders: Sender[];
  blocked: string | null;
};

const BIG_PRIMARY = "inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-brand px-5 text-[15px] font-semibold text-on-brand transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60";
const BIG_SECONDARY = "inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-line-strong px-4 text-[15px] font-semibold text-ink transition hover:bg-wash";
/** The same button for a moment after Copy message worked. */
const BIG_SECONDARY_DONE = "inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-transparent bg-brand/20 px-4 text-[15px] font-semibold text-brand-bright";

/**
 * What a doctor is called in the dropdown: their name for the office, and,
 * when patients will see something else, that too, so the admin knows what
 * the patient page will say before choosing.
 */
function doctorLabel(sender: Sender): string {
  if (!sender.patientName) return `${sender.name} (no name set for patients)`;
  if (sender.patientName === sender.name || sender.patientName === `Dr. ${sender.name}`) return sender.patientName;
  return `${sender.name} (patients see: ${sender.patientName})`;
}

/** The procedure and doctor dropdowns, side by side on a computer. Grouped by category, in the order the page gives. */
function Picks({
  idPrefix,
  procedures,
  senders,
  procedure,
  sender,
  onProcedure,
  onSender,
  disabled,
}: {
  idPrefix: string;
  procedures: ProcedureChoice[];
  senders: Sender[];
  procedure: string;
  sender: string;
  onProcedure: (id: string) => void;
  onSender: (id: string) => void;
  disabled: boolean;
}) {
  const groups: { label: string; items: ProcedureChoice[] }[] = [];
  for (const item of procedures) {
    const last = groups[groups.length - 1];
    if (last && last.label === item.categoryLabel) last.items.push(item);
    else groups.push({ label: item.categoryLabel, items: [item] });
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={`${idPrefix}-procedure`} className={LABEL}>
          Procedure
        </label>
        <select id={`${idPrefix}-procedure`} value={procedure} onChange={(event) => onProcedure(event.target.value)} disabled={disabled} className={`${INPUT} disabled:opacity-60`}>
          <option value="" disabled>
            Choose a procedure...
          </option>
          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                  {item.isPlaceholder ? " (placeholder)" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-from`} className={LABEL}>
          From
        </label>
        <select id={`${idPrefix}-from`} value={sender} onChange={(event) => onSender(event.target.value)} disabled={disabled} className={`${INPUT} disabled:opacity-60`}>
          <option value="" disabled>
            Choose a doctor...
          </option>
          {senders.map((person) => (
            <option key={person.userId} value={person.userId}>
              {doctorLabel(person)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** The link the form just made. */
type MadeLink = { code: string; senderName: string | null; title: string; isPlaceholder: boolean };

export function NewLinkForm({ procedures, senders, blocked, baseUrl, clinicName }: Choices & { baseUrl: string; clinicName: string }) {
  const [procedure, setProcedure] = useState("");
  const [sender, setSender] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<MadeLink | null>(null);
  // Set the moment the button is pressed, before React has redrawn it as disabled, so a double press makes one link.
  const busy = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (blocked) return setError(blocked);
    if (!procedure) return setError("Choose a procedure first.");
    if (!sender) return setError("Choose the doctor this link is from.");
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await createLinkAction(procedure, sender);
      if (result.ok) {
        const item = procedures.find((entry) => entry.id === procedure);
        setMade({ code: result.code, senderName: result.senderName, title: item?.title ?? "", isPlaceholder: item?.isPlaceholder ?? false });
      } else {
        setError(result.error);
      }
    } catch {
      // The request itself failed (the connection dropped). A link may or may not have been made; an unused one stops on its own.
      setError("We could not reach the server. Check the connection, then try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 max-w-2xl">
      <Picks idPrefix="link" procedures={procedures} senders={senders} procedure={procedure} sender={sender} onProcedure={setProcedure} onSender={setSender} disabled={pending} />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={BIG_PRIMARY}>
          {pending ? "Creating..." : "Create link"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-problem">
            {error}
          </p>
        )}
      </div>
      {made && <LinkReady key={made.code} link={made} baseUrl={baseUrl} clinicName={clinicName} />}
    </form>
  );
}

/** The new link: its QR code, its address, and what can be done with it. Making another link replaces it here; this one keeps working. */
function LinkReady({ link, baseUrl, clinicName }: { link: MadeLink; baseUrl: string; clinicName: string }) {
  const address = watchLink(baseUrl, link.code);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The browser refused (the page is not on https, say). The address is on screen beside the button, so it can still be selected by hand.
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5 sm:flex-row sm:items-center">
      <div className="shrink-0 self-center rounded-lg bg-white p-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- a drawn QR code, not a photo to resize */}
        <img src={`/admin/qr/${link.code}`} alt="" width={112} height={112} className="h-28 w-28" />
      </div>
      <div className="min-w-0">
        <p role="status" className="flex items-center gap-2 text-sm font-semibold text-brand-bright">
          <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-brand" />
          Link ready{link.senderName ? `, from ${link.senderName}` : ""}
        </p>
        <p className="mt-1 break-all text-[17px] font-semibold text-ink">{address}</p>
        {link.isPlaceholder && <p className="mt-1 text-sm text-warn">This plays a placeholder animation, not this procedure.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={copy} aria-live="polite" className={BIG_PRIMARY}>
            <CopyIcon className="h-5 w-5" />
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={() => setShowQr(true)} className={BIG_SECONDARY}>
            <QrIcon className="h-5 w-5" />
            QR on screen
          </button>
          {/* The pamphlet opens in a new tab, so the link is still here afterwards. */}
          <a href={`/admin/print/${link.code}`} target="_blank" rel="noopener" className={BIG_SECONDARY}>
            <PrinterIcon className="h-5 w-5" />
            Print
          </a>
          {/* A plain download link: the browser saves the picture under the name the server gives it. */}
          <a href={`/admin/qr/${link.code}`} download className={BIG_SECONDARY}>
            Download QR
          </a>
        </div>
        {/* The ready-made message with the link in it, for the office's own texting, email or patient portal.
            Made here in the browser; nothing about it goes to the server, and there is no box for the patient (lib/patient-message.ts). */}
        <div className="mt-3">
          <PatientMessageButtons message={patientMessage({ link: address, senderName: link.senderName, clinicName })} buttonClass={BIG_SECONDARY} doneClass={BIG_SECONDARY_DONE} />
        </div>
      </div>
      {showQr && <QrOnScreen title={link.title} image={`/admin/qr/${link.code}`} onClose={() => setShowQr(false)} />}
    </div>
  );
}

/**
 * The link's QR code as large as the screen allows, on white, for a patient
 * at the desk to scan with their own phone. Done, Escape or a tap on the dark
 * edge closes it; the link stays made.
 */
function QrOnScreen({ title, image, onClose }: { title: string; image: string; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(panel, true);
  return (
    <div
      ref={panel}
      className="fixed inset-0 z-50 flex overflow-y-auto bg-scrim p-3 sm:p-6"
      onClick={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => event.key === "Escape" && onClose()}
    >
      <div
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-screen-title"
        className="m-auto flex w-full max-w-2xl flex-col items-center rounded-2xl border border-line bg-surface p-5 text-center shadow-panel outline-none sm:p-7"
      >
        <div className="flex w-full items-start justify-between gap-4 text-left">
          <h2 id="qr-screen-title" className="text-2xl font-semibold leading-tight">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-soft hover:bg-wash hover:text-ink">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 rounded-2xl bg-white p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a drawn QR code, not a photo to resize */}
          <img src={image} alt="QR code that opens the patient's link to this video" className="h-[min(72vw,52vh,26rem)] w-[min(72vw,52vh,26rem)]" />
        </div>
        <p className="mt-5 text-lg text-ink">Point your phone&apos;s camera at the code, then tap the link that appears.</p>
        <div className="mt-5 flex w-full justify-end">
          <button type="button" onClick={onClose} className={BIG_PRIMARY}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** The printed code the form just made, or found already live for that doctor. */
type MadeCode = { id: string; created: boolean; title: string };

export function NewCodeForm({ procedures, senders, blocked }: Choices) {
  const [procedure, setProcedure] = useState("");
  const [sender, setSender] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<MadeCode | null>(null);
  const busy = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (blocked) return setError(blocked);
    if (!procedure) return setError("Choose a procedure first.");
    if (!sender) return setError("Choose the doctor this code is from.");
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await createQrCodeAction(procedure, sender);
      if (result.ok) setMade({ id: result.id, created: result.created, title: procedures.find((entry) => entry.id === procedure)?.title ?? "" });
      else setError(result.error);
    } catch {
      setError("We could not reach the server. Check the connection, then try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 max-w-2xl">
      <Picks idPrefix="code" procedures={procedures} senders={senders} procedure={procedure} sender={sender} onProcedure={setProcedure} onSender={setSender} disabled={pending} />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={BIG_PRIMARY}>
          {pending ? "Making..." : "Make printed code"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-problem">
            {error}
          </p>
        )}
      </div>
      {made && (
        <div key={made.id} className="mt-6 flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5 sm:flex-row sm:items-center">
          <div className="shrink-0 self-center rounded-lg bg-white p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- a drawn QR code, not a photo to resize */}
            <img src={`/admin/qr-codes/${made.id}/image`} alt="" width={112} height={112} className="h-28 w-28" />
          </div>
          <div className="min-w-0">
            <p role="status" className="text-sm font-semibold text-brand-bright">
              {made.created ? "Printed code made" : "This doctor already has a printed code for this procedure"}
            </p>
            <p className="mt-1 text-[17px] font-semibold text-ink">{made.title}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={`/admin/qr-codes/${made.id}`} target="_blank" rel="noopener" className={BIG_PRIMARY}>
                <PrinterIcon className="h-5 w-5" />
                Print
              </a>
              <a href={`/admin/qr-codes/${made.id}/image`} download className={BIG_SECONDARY}>
                Download QR
              </a>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}

/**
 * Print, Download, Replace and Retire on one printed code. Retire and
 * Replace each ask first, because every printed copy of the code stops
 * working at once. Replace is not offered when the code's surgeon no longer
 * holds a seat, since a new code would be in that surgeon's name.
 */
export function CodeActions({ id, title, surgeonName, surgeonSeated }: { id: string; title: string; surgeonName: string | null; surgeonSeated: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <a href={`/admin/qr-codes/${id}`} target="_blank" rel="noopener" className={BIG_PRIMARY}>
        <PrinterIcon className="h-5 w-5" />
        Print
      </a>
      <a href={`/admin/qr-codes/${id}/image`} download className={BIG_SECONDARY}>
        Download QR
      </a>
      {surgeonSeated && (
        <ConfirmButton
          label="Replace"
          title="Replace this printed code?"
          body={
            <>
              <p>
                A new code is made for {title}
                {surgeonName ? `, from ${surgeonName}` : ""}, and the old one stops working on every copy that was printed or downloaded.
              </p>
              <p className="mt-3">Links it already gave patients keep working. You will need to print the new code.</p>
            </>
          }
          yes="Yes, replace it"
          action={() => replaceQrCodeAction(id)}
        />
      )}
      <ConfirmButton
        label="Retire"
        title="Retire this printed code?"
        body={
          <>
            <p>The code for {title} stops working on every copy that was printed or downloaded. This cannot be undone; you can make a new code instead.</p>
            <p className="mt-3">Links it already gave patients keep working.</p>
          </>
        }
        yes="Yes, retire it"
        danger
        action={() => retireQrCodeAction(id)}
      />
    </div>
  );
}
