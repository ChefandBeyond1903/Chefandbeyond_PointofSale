"use client";

import { useEffect, useState } from "react";

export const PAGE_SIZES = [25, 50, 75, 100] as const;

/** Client-side pagination over an already-loaded (and filtered) list. */
export function usePaged<T>(items: T[], sizes: readonly number[] = PAGE_SIZES) {
  const [size, setSize] = useState(sizes[0]);
  const [page, setPage] = useState(1);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));

  // Keep the page in range when the list shrinks (search, delete, size change).
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const start = (page - 1) * size;
  const pageItems = items.slice(start, start + size);

  return {
    pageItems,
    page,
    setPage,
    size,
    setSize: (n: number) => {
      setSize(n);
      setPage(1);
    },
    sizes,
    pageCount,
    total,
    start,
  };
}
