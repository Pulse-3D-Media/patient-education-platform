/** Skeleton shown while the library home fetches its counts. */
export default function Loading() {
  return (
    <div className="animate-pulse px-5 py-6 sm:px-8">
      <div className="mb-6 h-8 w-64 rounded bg-white/10" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="aspect-[16/9] rounded-2xl bg-white/5" />
        ))}
      </div>
    </div>
  );
}
