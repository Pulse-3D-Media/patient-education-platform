"use client";

import { useEffect, useRef } from "react";

/**
 * The one bit of the website's script the "three ways" pictures need:
 * each picture comes alive (its little animation, and the silent video)
 * only while it is on screen, and stops when it scrolls away.
 *
 * - The video has no address until its picture is on screen, so nothing is
 *   downloaded for a picture nobody looks at, and the sign-in box never waits
 *   for it.
 * - It is always muted (set again here, because a browser can ignore the
 *   attribute), so nothing ever plays sound by itself.
 * - With "reduce motion" or data saver on, no video is loaded at all: the
 *   still picture stays.
 *
 * It draws nothing itself; it sits inside the section and finds the
 * pictures around it.
 */
export function WaysMotion() {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = marker.current?.closest<HTMLElement>("[data-ways]");
    if (!root || !("IntersectionObserver" in window)) return;

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
    root.classList.add("is-live");

    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const way = entry.target as HTMLElement;
          way.classList.toggle("play", entry.isIntersecting);
          for (const video of way.querySelectorAll<HTMLVideoElement>("video[data-src]")) {
            if (!entry.isIntersecting) {
              if (!video.paused) video.pause();
              continue;
            }
            if (calm || saveData) continue;
            video.muted = true;
            if (!video.getAttribute("src")) video.src = video.dataset.src ?? "";
            // A browser may refuse to play (low power mode); the still picture then stays, which is fine.
            video.play().catch(() => {});
          }
        }
      },
      { threshold: 0.35 },
    );
    root.querySelectorAll("[data-play]").forEach((way) => watcher.observe(way));
    return () => watcher.disconnect();
  }, []);

  return <span ref={marker} hidden />;
}
