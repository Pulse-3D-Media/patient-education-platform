import Link from "next/link";

/**
 * What an org:member sees if they open /admin or anything under it. The
 * page is checked on the server (isClinicAdmin() in lib/roles.ts), so this
 * is what the check shows, not just a hidden button.
 */
export function AdminsOnly() {
  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-xl py-10">
        <h1 className="text-2xl font-semibold sm:text-3xl">This page is for your clinic&rsquo;s office admins.</h1>
        <p className="mt-3 text-[#bfbfbf]">
          You can browse the library and send videos to patients. Share links, QR codes and people are managed by an
          admin. If you need something changed, ask them.
        </p>
        <Link
          href="/library"
          className="mt-6 inline-flex h-11 items-center rounded-lg bg-[#2a829b] px-5 text-sm font-medium text-white transition hover:bg-[#1e5668]"
        >
          Back to the library
        </Link>
      </div>
    </main>
  );
}
