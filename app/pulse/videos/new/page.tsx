import Link from "next/link";
import { requirePulseStaff } from "@/lib/pulse";
import { VideoForm } from "../VideoForm";

/** Add a video to the catalogue. Staff only. Once saved, the staff member lands on the video's own page. */
export const dynamic = "force-dynamic";

export default async function NewVideoPage() {
  await requirePulseStaff();

  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <p className="text-sm text-[#667085]">
            <Link href="/pulse/videos" className="hover:text-white">
              Videos
            </Link>
            <span className="mx-2">/</span>
            <span className="text-[#bfbfbf]">Add video</span>
          </p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Add a video</h1>
          <p className="mt-1 max-w-2xl text-[#bfbfbf]">
            It shows in the library as soon as it is published. Leave &ldquo;Published&rdquo; off to keep it out of sight while
            it is checked.
          </p>
        </header>
        <div className="rounded-2xl border border-white/10 bg-[#0d1113] p-5 sm:p-6">
          <VideoForm />
        </div>
      </div>
    </main>
  );
}
