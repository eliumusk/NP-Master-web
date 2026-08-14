export default function JobsLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <div className="skeleton h-7 w-28 rounded-btn" />
          <div className="skeleton h-4 w-52 rounded-btn" />
        </div>
        <div className="skeleton h-9 w-24 rounded-btn" />
      </div>
      <div className="overflow-hidden rounded-card border border-white/[0.08]">
        <div className="border-b border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <div className="skeleton h-3.5 w-44 rounded-btn" />
        </div>
        <div>
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="flex items-center gap-6 border-b border-white/[0.06] px-4 py-3.5 last:border-0"
            >
              <div className="skeleton h-5 w-16 rounded-pill" />
              <div className="flex-1 space-y-1.5">
                <div className="skeleton h-4 w-44 rounded-btn" />
                <div className="skeleton h-3 w-20 rounded-btn" />
              </div>
              <div className="skeleton hidden h-4 w-6 rounded-btn sm:block" />
              <div className="skeleton hidden h-4 w-6 rounded-btn sm:block" />
              <div className="skeleton hidden h-4 w-6 rounded-btn sm:block" />
              <div className="skeleton h-4 w-24 rounded-btn" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
