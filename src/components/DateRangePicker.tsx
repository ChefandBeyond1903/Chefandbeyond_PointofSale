"use client";

import { useState } from "react";
import {
  DATE_RANGE_PRESETS,
  endOfDay,
  parseLocalDate,
  resolvePreset,
  startOfDay,
  toDateInputValue,
  type DateRange,
  type DateRangePresetKey,
} from "@/lib/dateRange";

type Selection = DateRangePresetKey | "custom";

/**
 * A preset date-range dropdown (Today, This week, Last quarter, …) plus a
 * "Custom" option that reveals start/end date inputs. Calls `onChange` with the
 * resolved {from, to} whenever the effective range changes.
 */
export function DateRangePicker({
  defaultPreset = "today",
  onChange,
  className = "",
}: {
  defaultPreset?: DateRangePresetKey;
  /** `label` is the chosen preset's name (or "Custom range"); `key` is the
   *  preset key (or "custom"). */
  onChange: (range: DateRange, label: string, key: DateRangePresetKey | "custom") => void;
  className?: string;
}) {
  const [selection, setSelection] = useState<Selection>(defaultPreset);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  function emitCustom(fromStr: string, toStr: string) {
    const from = parseLocalDate(fromStr);
    const to = parseLocalDate(toStr);
    if (!from || !to) return;
    const lo = from <= to ? from : to;
    const hi = from <= to ? to : from;
    onChange({ from: startOfDay(lo), to: endOfDay(hi) }, "Custom range", "custom");
  }

  function handleSelect(next: Selection) {
    setSelection(next);
    if (next !== "custom") {
      const label = DATE_RANGE_PRESETS.find((p) => p.key === next)?.label ?? "";
      onChange(resolvePreset(next), label, next);
      return;
    }
    // Seed the custom inputs with the current month so there's a valid range.
    if (!customFrom || !customTo) {
      const seed = resolvePreset("this_month");
      const f = toDateInputValue(seed.from);
      const t = toDateInputValue(new Date());
      setCustomFrom(f);
      setCustomTo(t);
      emitCustom(f, t);
    } else {
      emitCustom(customFrom, customTo);
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <select
        className="input h-8 w-auto min-w-40"
        value={selection}
        onChange={(e) => handleSelect(e.target.value as Selection)}
        aria-label="Date range"
      >
        {DATE_RANGE_PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>

      {selection === "custom" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            className="input h-8 w-auto"
            value={customFrom}
            max={customTo || undefined}
            onChange={(e) => {
              setCustomFrom(e.target.value);
              emitCustom(e.target.value, customTo);
            }}
            aria-label="Start date"
          />
          <span className="text-sm text-zinc-400">to</span>
          <input
            type="date"
            className="input h-8 w-auto"
            value={customTo}
            min={customFrom || undefined}
            onChange={(e) => {
              setCustomTo(e.target.value);
              emitCustom(customFrom, e.target.value);
            }}
            aria-label="End date"
          />
        </div>
      )}
    </div>
  );
}
