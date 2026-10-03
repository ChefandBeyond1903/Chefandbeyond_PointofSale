"use client";

import type { SortDir } from "@/lib/useSort";

/** A <th> whose label is a click-to-sort button, with a ▲/▼/⇅ indicator. */
export function SortTh<K extends string>({
  children,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "left",
  className = "",
  title,
}: {
  children: React.ReactNode;
  sortKey: K;
  activeKey: K | null;
  dir: SortDir;
  onSort: (key: K) => void;
  align?: "left" | "right";
  className?: string;
  title?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th className={className} title={title}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-zinc-700 ${
          align === "right" ? "flex-row-reverse" : ""
        }`}
      >
        <span>{children}</span>
        <span className={`text-[9px] leading-none ${active ? "text-zinc-600" : "text-zinc-300"}`}>
          {active ? (dir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </button>
    </th>
  );
}
