/** Skeleton shown while the watch page fetches its video: the video's box, a title, and the "More in" column. */
export default function Loading() {
  return (
    <div className="animate-pulse px-3 py-4 sm:px-6 lg:px-8">
      <div className="mb-3 h-11 w-11 rounded-full bg-wash" />
      <div className="grid gap-6 side-by-side:grid-cols-[minmax(0,1fr)_22rem] xl:side-by-side:grid-cols-[minmax(0,1fr)_25rem]">
        <div>
          <div className="aspect-video w-full rounded-xl bg-wash" />
          <div className="mt-4 h-8 w-2/3 rounded bg-wash-strong" />
          <div className="mt-4 h-10 w-48 rounded-full bg-wash" />
        </div>
        <div className="flex flex-col gap-3">
          <div className="h-7 w-40 rounded bg-wash-strong" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[5.6rem] rounded-xl bg-wash" />
          ))}
        </div>
      </div>
    </div>
  );
}
