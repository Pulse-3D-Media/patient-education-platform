import Link from "next/link";

/**
 * What a signed-in person sees when a staff page says not-found: a
 * category that does not exist under /library, a link that is not this
 * clinic's under /admin, a clinic or video id that is not on /pulse. One
 * sentence and a way back. No detail about what was looked for, and no
 * hint about whether it exists for someone else (rule 8: a wrong address
 * and someone else's record look the same).
 *
 * Each staff surface's not-found.tsx draws this with its own way back. In
 * the tokens, so it takes the clinic's mode inside the library's shell and
 * is dark where there is no shell.
 *
 * Someone who is not Pulse staff and opens /pulse never sees this one: the
 * /pulse layout says not-found before any of its pages, and that lands on
 * the root not-found page, with no dashboard around it.
 */
export function StaffNotFound({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <main className="flex flex-1 flex-col bg-ground px-5 py-6 text-ink sm:px-8">
      <div className="mx-auto w-full max-w-xl py-10">
        <h1 className="text-2xl font-semibold sm:text-3xl">We couldn&rsquo;t find that page</h1>
        <p className="mt-3 text-ink-soft">It may have moved, or the address may be wrong.</p>
        <Link
          href={backHref}
          className="mt-6 inline-flex h-11 items-center rounded-lg bg-brand px-5 text-sm font-medium text-on-brand transition hover:bg-brand-hover"
        >
          {backLabel}
        </Link>
      </div>
    </main>
  );
}
