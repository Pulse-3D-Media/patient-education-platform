import { ClinicLogo } from "./ClinicLogo";

/**
 * The quiet clinic mark in a reserved strip above the picture:
 * the clinic's logo on a small, slightly see-through white chip, or the
 * clinic's name in its place when there is no logo or it does not load.
 *
 * Anatomy labels and captions can be anywhere, so callers put this in a
 * separate row outside the video. Even a translucent mark could hide a
 * clinical label if it were placed over the picture.
 *
 * It never takes a tap (pointer-events-none), so whatever is under it still
 * works, and screen readers skip it: the clinic's name is already on the
 * page.
 *
 * What it is NOT: protection. It is drawn by the web page over the video,
 * so it is not part of the video file, and it is not shown when the phone's
 * own full-screen player or picture-in-picture takes the video over. It
 * tells a patient who sent this. It does not stop copying.
 *
 * The white chip is deliberate. Most logos are drawn for a white page; on a
 * dark frame of the animation a dark logo would disappear, and on a light
 * frame a white one would. A chip reads over any frame.
 */
export function ClinicMark({
  logoUrl,
  name,
  size,
  className = "",
}: {
  logoUrl: string | null;
  name: string;
  /** "patient" keeps the name at 15px, the smallest text the patient page allows. "staff" is a little smaller. */
  size: "patient" | "staff";
  /** Where it sits, as Tailwind position classes ("right-3 top-3"). */
  className?: string;
}) {
  const nameClass = `font-semibold text-[#12202a] ${size === "patient" ? "text-[15px]" : "text-[13px]"}`;

  return (
    <div aria-hidden="true" className={`pointer-events-none absolute z-10 flex max-w-[46%] select-none ${className}`}>
      <span className="flex min-w-0 items-center rounded-md bg-white/85 px-2 py-1 opacity-90 shadow-[0_1px_6px_rgba(0,0,0,.35)]">
        {logoUrl ? (
          // A fixed box, so the chip is the same size before, during and after the logo loads.
          <ClinicLogo src={logoUrl} name={name} boxClassName="h-6 w-[104px] max-w-full" nameClassName={nameClass} position="center" />
        ) : (
          <span className={`truncate ${nameClass}`}>{name}</span>
        )}
      </span>
    </div>
  );
}
