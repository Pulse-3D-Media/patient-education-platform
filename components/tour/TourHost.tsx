"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { readTourRequest } from "@/lib/tour";

/**
 * The only piece of the tour that is in every library and admin page: it
 * looks at the address for ?tour=..., and draws nothing when there is none.
 *
 * THE SPEED RULE: the tour's own code (Tour.tsx, the shade, the caption, the
 * offer) is a separate file the browser downloads only when the address asks
 * for the tour (next/dynamic, a lazy import). A normal library visit loads
 * none of it, and this host draws nothing, so the first paint and the way to
 * a playing video are exactly as they were.
 *
 * `isAdmin` is the courtesy the menu already uses (the server worked it out):
 * it only decides whether the tour has its third stop. The admin pages check
 * for themselves.
 */
const Tour = dynamic(() => import("./Tour").then((module) => module.Tour), { ssr: false });

export function TourHost({ isAdmin }: { isAdmin: boolean }) {
  // Reading the address needs a Suspense boundary of its own, so a page drawn ahead of time is never held up by it.
  return (
    <Suspense fallback={null}>
      <TourFromAddress isAdmin={isAdmin} />
    </Suspense>
  );
}

function TourFromAddress({ isAdmin }: { isAdmin: boolean }) {
  const request = readTourRequest(useSearchParams());
  if (!request) return null;
  return <Tour request={request} isAdmin={isAdmin} />;
}
