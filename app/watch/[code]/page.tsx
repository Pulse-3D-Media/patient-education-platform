/**
 * The patient viewer. Phone-first, no login, nothing to click except play.
 * Built in a later step. This placeholder only proves the route exists.
 */
export default async function WatchPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return (
    <main className="min-h-screen bg-black p-6 text-[#bfbfbf]">
      <p>Patient viewer for share code {code}. Coming in a later step.</p>
    </main>
  );
}
