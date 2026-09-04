"use client";

import { useEffect, useState } from "react";

export type PrintPaper = "full" | "thermal";
const KEY = "cb-pos-print-paper";

/** Remembers the operator's last receipt paper choice across prints. */
export function usePrintPaper(): [PrintPaper, (p: PrintPaper) => void] {
  const [paper, setPaper] = useState<PrintPaper>("full");
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "thermal" || v === "full") setPaper(v);
    } catch {
      /* storage unavailable — keep the default */
    }
  }, []);
  const set = (p: PrintPaper) => {
    setPaper(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* ignore */
    }
  };
  return [paper, set];
}

/** Segmented control: full sheet (Letter/A4) vs. 80 mm thermal roll. */
export function PrintPaperToggle({
  value,
  onChange,
}: {
  value: PrintPaper;
  onChange: (p: PrintPaper) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-zinc-300 text-xs">
      {(["full", "thermal"] as const).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={`px-2.5 py-1 font-medium ${
            value === p ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-50"
          }`}
        >
          {p === "full" ? "Full page" : "Thermal 80mm"}
        </button>
      ))}
    </div>
  );
}
