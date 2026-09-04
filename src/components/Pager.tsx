"use client";

/** Rows-per-page selector + prev/next, driven by usePaged(). */
export function Pager({
  page,
  setPage,
  size,
  setSize,
  sizes,
  pageCount,
  total,
  start,
  className = "",
}: {
  page: number;
  setPage: (n: number) => void;
  size: number;
  setSize: (n: number) => void;
  sizes: readonly number[];
  pageCount: number;
  total: number;
  start: number;
  className?: string;
}) {
  if (total === 0) return null;
  const from = start + 1;
  const to = Math.min(start + size, total);
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 ${className}`}
    >
      <label className="flex items-center gap-1">
        Rows
        <select
          className="input h-7 w-auto py-0 text-xs"
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
        >
          {sizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setPage(page - 1)}
          disabled={page <= 1}
          className="btn-ghost h-7 px-2 disabled:opacity-40"
        >
          Prev
        </button>
        <span>
          {page} / {pageCount}
        </span>
        <button
          type="button"
          onClick={() => setPage(page + 1)}
          disabled={page >= pageCount}
          className="btn-ghost h-7 px-2 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
