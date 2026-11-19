/* eslint-disable @next/next/no-img-element -- small fixed logo file, served from our own address */
import { LOGO_HEIGHT, LOGO_URL, LOGO_WIDTH } from "@/lib/brand";
import { SITE_CALL, SITE_LINKS, SITE_ORIGIN } from "@/lib/landing";

/**
 * The Pulse 3D website's navigation, across the top of the landing page, so
 * the page reads as part of the website (the approved design, screen 01).
 * Every link goes to the website; "Patient Education" is marked as the
 * section this page belongs to.
 *
 * On a phone the links fold into a menu button. It is a plain
 * <details> element, which the browser opens and closes itself, so there is
 * no script to load.
 */
export function SiteNav() {
  const link = "inline-flex min-h-11 items-center px-3 text-[0.9375rem] font-medium no-underline hover:text-brand-bright";
  return (
    <header className="relative flex items-center justify-between gap-5 border-b border-line bg-ground px-4 py-3 min-[860px]:px-14 min-[860px]:py-[18px]">
      <a href={`${SITE_ORIGIN}/`} className="shrink-0">
        <img src={LOGO_URL} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="Pulse 3D Media" className="block h-10 w-auto" />
      </a>

      <nav aria-label="Pulse 3D Media" className="hidden items-center gap-0.5 min-[860px]:flex">
        {SITE_LINKS.map((item) => (
          <a key={item.label} href={item.href} aria-current={item.current ? "page" : undefined} className={`${link} ${item.current ? "text-brand-bright" : "text-ink"}`}>
            {item.label}
          </a>
        ))}
        <a href={SITE_CALL.href} className="ml-2.5 inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-[0.9375rem] font-semibold text-on-brand no-underline hover:bg-brand-hover">
          {SITE_CALL.label}
        </a>
      </nav>

      <details className="group min-[860px]:hidden">
        <summary className="grid size-11 cursor-pointer list-none place-items-center text-ink [&::-webkit-details-marker]:hidden" aria-label="Menu">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" className="group-open:hidden" />
            <path d="M6 6l12 12M18 6L6 18" className="hidden group-open:block" />
          </svg>
        </summary>
        <nav aria-label="Pulse 3D Media" className="absolute inset-x-0 top-full z-20 grid gap-1 border-b border-line bg-ground px-4 pb-4 pt-2 shadow-lift">
          {SITE_LINKS.map((item) => (
            <a key={item.label} href={item.href} aria-current={item.current ? "page" : undefined} className={`${link} ${item.current ? "text-brand-bright" : "text-ink"}`}>
              {item.label}
            </a>
          ))}
          <a href={SITE_CALL.href} className="mt-2 inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 font-semibold text-on-brand no-underline hover:bg-brand-hover">
            {SITE_CALL.label}
          </a>
        </nav>
      </details>
    </header>
  );
}
