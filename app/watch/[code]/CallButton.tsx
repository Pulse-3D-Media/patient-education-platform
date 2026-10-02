import { PhoneIcon } from "@/components/ui/icons";

/**
 * The one large tap-to-call button on the patient page, for when there is
 * nothing left to do but call the office. A plain tel: link, so the phone
 * asks before it dials. In the clinic's colour, 56px tall, like every
 * button on this page. No server code, so the paused page's client piece
 * can use it too.
 *
 * On a computer a tel: link does nothing useful (at best it opens some other
 * app), so there the number is shown as plain, easy-to-read words instead:
 * "Call your clinic: (801) 555-0123". Which one shows is decided by the
 * browser with a media query (the "computer:" variant in app/globals.css:
 * a mouse or trackpad that can hover), never by guessing from the browser's
 * name, so the page the server sends is the same for everyone. Both are in
 * the page; only one is ever visible, and the hidden one is hidden from
 * screen readers too.
 */
export function CallButton({ call }: { call: { href: string; label: string } }) {
  return (
    <>
      <a
        href={call.href}
        className="mt-7 flex min-h-14 items-center gap-3 rounded-full bg-brand px-8 text-[19px] font-semibold text-on-brand shadow-[0_6px_18px_-8px_rgba(18,32,42,.45)] transition active:scale-[0.98] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#12202a] computer:hidden"
      >
        <PhoneIcon className="h-6 w-6 shrink-0" />
        Call {call.label}
      </a>
      <CallNumber call={call} className="mt-7 text-[19px]" />
    </>
  );
}

/**
 * The clinic's number as plain words, for a computer only (hidden on phones
 * and tablets, which get a tap-to-call link instead). Not a link: nothing to
 * click, and the number can be read out or copied.
 */
export function CallNumber({ call, className = "" }: { call: { label: string }; className?: string }) {
  return (
    <p className={`hidden items-center gap-2 font-medium computer:flex ${className}`}>
      <PhoneIcon className="h-5 w-5 shrink-0" />
      <span>
        Call your clinic: <span className="font-semibold whitespace-nowrap">{call.label}</span>
      </span>
    </p>
  );
}
