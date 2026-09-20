import Link from "next/link";

/**
 * What an org:member sees if they open /admin or anything under it. The
 * page is checked on the server (isClinicAdmin() in lib/roles.ts), so this
 * is what the check shows, not just a hidden button.
 *
 * `billing` is true on the Billing pages. A member can land there from a
 * closed clinic, where "you can browse the library" would not be true, so
 * they are told who can sort billing out instead.
 */
export function AdminsOnly({ billing = false }: { billing?: boolean }) {
  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-xl py-10">
        <h1 className="text-2xl font-semibold sm:text-3xl">This page is for your clinic&rsquo;s office admins.</h1>
        <p className="mt-3 text-ink-soft">
          {billing
            ? "Your clinic's plan and payments are handled by its office admins. If the clinic is not open yet, or a payment needs sorting out, ask one of them to open Billing."
            : "You can browse the library and send videos to patients. Share links, QR codes and people are managed by an admin. If you need something changed, ask them."}
        </p>
        <Link
          href="/library"
          className="mt-6 inline-flex h-11 items-center rounded-lg bg-brand px-5 text-sm font-medium text-on-brand transition hover:bg-brand-hover"
        >
          Back to the library
        </Link>
      </div>
    </main>
  );
}
