import { PhoneIcon } from "@/components/ui/icons";

/**
 * The one large tap-to-call button on the patient page, for when there is
 * nothing left to do but call the office. A plain tel: link, so the phone
 * asks before it dials. In the clinic's colour, 56px tall, like every
 * button on this page. No server code, so the paused page's client piece
 * can use it too.
 */
export function CallButton({ call }: { call: { href: string; label: string } }) {
  return (
    <a
      href={call.href}
      className="mt-7 flex min-h-14 items-center gap-3 rounded-full bg-brand px-8 text-[19px] font-semibold text-on-brand shadow-[0_6px_18px_-8px_rgba(18,32,42,.45)] transition active:scale-[0.98] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#12202a]"
    >
      <PhoneIcon className="h-6 w-6 shrink-0" />
      Call {call.label}
    </a>
  );
}
