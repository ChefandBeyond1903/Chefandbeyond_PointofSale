"use client";

import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";

/**
 * Click-to-sort over an already-loaded list. `getValue` resolves whatever a
 * column key means for a row; sorting falls back to `defaultSort` until a
 * column header is actually clicked, then sorts by that column (numbers
 * numerically, everything else as natural-sorted text), nulls last.
 */
export function useSort<T, K extends string>(
  rows: T[],
  getValue: (row: T, key: K) => string | number | null | undefined,
  defaultSort?: (a: T, b: T) => number,
) {
  const [sortKey, setSortKey] = useState<K | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function sortBy(key: K) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return defaultSort ? [...rows].sort(defaultSort) : rows;
    const mul = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = getValue(a, sortKey);
      const bv = getValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * mul;
      return (
        String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * mul
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, sortBy };
}
