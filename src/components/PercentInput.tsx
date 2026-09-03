"use client";

import { useEffect, useState } from "react";

/** Controlled percent input. Keeps a local text buffer so decimals type cleanly. */
export function PercentInput({
  value,
  onValueChange,
  onCommit,
  className = "input",
  placeholder = "0",
  max = 100,
  "aria-label": ariaLabel,
}: {
  value: number;
  onValueChange: (n: number) => void;
  /** Fired once the value is committed — on blur or Enter. */
  onCommit?: () => void;
  className?: string;
  placeholder?: string;
  max?: number;
  "aria-label"?: string;
}) {
  const fmt = (n: number) => (n ? String(Math.round(n * 100) / 100) : "");
  const [text, setText] = useState(fmt(value));

  useEffect(() => {
    setText((cur) => {
      const parsed = parseFloat(cur.replace(/[^0-9.]/g, ""));
      return (Number.isFinite(parsed) ? parsed : 0) === value ? cur : fmt(value);
    });
  }, [value]);

  const clamp = (n: number) => Math.max(0, Math.min(max, n));

  return (
    <input
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9.]/g, "");
        setText(raw);
        const n = parseFloat(raw);
        onValueChange(Number.isFinite(n) ? clamp(n) : 0);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      onBlur={() => {
        const n = parseFloat(text.replace(/[^0-9.]/g, ""));
        setText(Number.isFinite(n) ? fmt(clamp(n)) : "");
        onCommit?.();
      }}
    />
  );
}
