"use client";

import { UserButton } from "@clerk/nextjs";
import { TOUR_START_HREF } from "@/lib/tour";
import { PlayIcon } from "./icons";

/**
 * The signed-in person's avatar: Clerk's own user button, whose menu holds
 * Sign out. In the clinic's library and admin pages the same menu also has
 * "Take the tour", the quiet way to start the tour again by hand (it opens
 * the tour's first stop on the library home). It is only a link: nothing of
 * the tour loads until it is pressed.
 *
 * `appearance` and `showName` go straight to Clerk's button.
 */
export function AccountButton({
  tour = false,
  showName = false,
  appearance,
}: {
  /** Adds "Take the tour" to the menu. Left out on the Pulse 3D dashboard, which has no tour. */
  tour?: boolean;
  showName?: boolean;
  appearance?: Parameters<typeof UserButton>[0]["appearance"];
}) {
  if (!tour) return <UserButton showName={showName} appearance={appearance} />;
  return (
    <UserButton showName={showName} appearance={appearance}>
      <UserButton.MenuItems>
        <UserButton.Link label="Take the tour" labelIcon={<PlayIcon className="h-4 w-4" />} href={TOUR_START_HREF} />
      </UserButton.MenuItems>
    </UserButton>
  );
}
