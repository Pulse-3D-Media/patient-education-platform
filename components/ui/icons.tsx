/**
 * The app's few icons, drawn inline so there is no icon font or package.
 * All take a className so size and colour come from Tailwind.
 */

type IconProps = { className?: string };

/** Three book spines on a shelf. The Procedure Library symbol everywhere. */
export function BooksIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="3" y="4" width="4" height="15" rx="0.8" />
      <rect x="9" y="4" width="4" height="15" rx="0.8" />
      <path d="M15.6 5.4l3.7-1 3.5 13.6-3.7 1z" />
      <path d="M2.5 20.5h19" />
    </svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
