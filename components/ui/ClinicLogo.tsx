"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A clinic's logo in a box of fixed size, with the clinic's name standing in
 * until the picture has really loaded, and for good if it never does.
 *
 * The box is sized by the caller and never changes, so a logo that is slow,
 * missing, broken, or in a format the browser cannot show moves nothing on
 * the page: not the text under it, and never the video. The picture starts
 * invisible and only appears once the browser says it loaded; until then
 * (and after a failure) the name shows in its place, or nothing at all
 * where the caller says the name is already written right beside it.
 *
 * The logo can come from more than one place (Clerk's image host for a logo
 * the clinic uploaded, or any https address Pulse staff approved), so this
 * is a plain <img> that the browser fetches itself. It is deliberately not
 * Next.js's image optimizer: that works by having OUR server fetch the
 * address, and a server that fetches whatever address it is given is a
 * security hole. A plain <img> needs no list of allowed hosts and makes no
 * request from inside our network.
 *
 * Three settings on the picture, each on purpose:
 *   - fetchPriority "low" and decoding "async": the browser can prioritize
 *     video and draw the page without waiting for the logo to decode.
 *   - referrerPolicy "no-referrer": the address of a patient's page holds
 *     their share code, and the logo's host has no business seeing it.
 *
 * Always hidden from screen readers. Wherever it is used, the clinic's name
 * is already there as text or as a label, and hearing it twice helps nobody.
 *
 * A client component because only the browser knows whether the picture
 * loaded.
 */
export function ClinicLogo({
  src,
  ...props
}: ClinicLogoProps) {
  // A changed address needs a fresh loading state, including after a failed
  // image was removed. Otherwise a new valid logo could never be requested.
  return <LogoImage key={src ?? "no-logo"} src={src} {...props} />;
}

type ClinicLogoProps = {
  src: string | null;
  name: string;
  boxClassName: string;
  fallback?: "name" | "blank";
  nameClassName?: string;
  position?: "left" | "center";
};

function LogoImage({
  src,
  name,
  boxClassName,
  fallback = "name",
  nameClassName = "",
  position = "left",
}: {
  /** The logo's address, or null when the clinic has none. */
  src: string | null;
  name: string;
  /** The box's size, as Tailwind classes ("h-11 w-[220px]"). It stays this size whatever happens to the picture. */
  boxClassName: string;
  /** What shows while the picture is loading or if it cannot load: the clinic's name, or nothing. */
  fallback?: "name" | "blank";
  /** Extra classes for the name when it stands in (size, colour). */
  nameClassName?: string;
  /** Where the picture sits inside the box when it is narrower than the box. */
  position?: "left" | "center";
}) {
  const img = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"waiting" | "loaded" | "failed">("waiting");

  // The picture can finish loading (or failing) before React has attached
  // onLoad and onError, because the server sent the <img> in the page's
  // HTML. decode() settles either way, even for a picture that finished
  // long ago, so it catches what the two handlers missed.
  useEffect(() => {
    const picture = img.current;
    if (!picture || typeof picture.decode !== "function") return;
    let current = true;
    picture.decode().then(
      () => current && setState("loaded"),
      () => {
        // Some browsers refuse to decode a picture they did load (a very
        // large one, say). If it is there, it is there.
        if (current) setState(picture.complete && picture.naturalWidth > 0 ? "loaded" : "failed");
      },
    );
    return () => {
      current = false;
    };
  }, [src]);

  const showName = fallback === "name" && state !== "loaded";

  return (
    <span
      aria-hidden="true"
      className={`relative flex items-center overflow-hidden ${position === "center" ? "justify-center" : ""} ${boxClassName}`}
    >
      {showName && <span className={`truncate ${nameClassName}`}>{name}</span>}
      {src && state !== "failed" && (
        // eslint-disable-next-line @next/next/no-img-element -- see the note above: the browser fetches the logo, our server never does
        <img
          ref={img}
          src={src}
          alt=""
          decoding="async"
          fetchPriority="low"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
          className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${
            position === "center" ? "object-center" : "object-left"
          } ${state === "loaded" ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </span>
  );
}
