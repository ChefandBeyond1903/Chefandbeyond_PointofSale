/**
 * Placeholder shown while a route's server component and its first data fetch
 * are in flight. Keeps tab switches feeling instant instead of blank.
 */
export function RouteSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="w-full flex-1 p-4" aria-busy="true" aria-label="Loading">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-6 w-40 animate-pulse rounded bg-zinc-200" />
        <div className="ml-auto h-8 w-28 animate-pulse rounded bg-zinc-200" />
      </div>
      <div className="card overflow-hidden">
        <div className="h-9 w-full animate-pulse bg-zinc-100" />
        <div className="divide-y divide-zinc-100">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-4 w-4 animate-pulse rounded bg-zinc-200" />
              <div className="h-4 flex-1 animate-pulse rounded bg-zinc-200" />
              <div className="h-4 w-24 animate-pulse rounded bg-zinc-200" />
              <div className="h-4 w-16 animate-pulse rounded bg-zinc-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
