import { requirePulseStaff } from "@/lib/pulse";
import { ComingSoon } from "../ui";

/** Placeholder for the Videos section. Staff only, like every page here. */
export const dynamic = "force-dynamic";

export default async function PulseVideosPage() {
  await requirePulseStaff();
  return (
    <ComingSoon
      title="Videos"
      blurb="The library itself: every animation, published or not, placeholder or finished, and the file behind each one. Until this is built, videos are managed with the seed scripts in prisma/."
    />
  );
}
