"use client";

import { useEffect, useState } from "react";
import { parseMoney } from "@/lib/money";

/** Controlled dollar input that reports integer cents. */
export function MoneyInput({
  cents,
  onCentsChange,
  onCommit,
  className = "input",
  placeholder = "0.00",
  autoFocus,
  id,
  disabled,
}: {
  cents: number;
  onCentsChange: (cents: number) => void;
  /** Fired once the value is committed — on blur or Enter. */
  onCommit?: (cents: number) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  id?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(cents ? (cents / 100).toFixed(2) : "");

  useEffect(() => {
    // Keep in sync when the parent resets the value (e.g. after a sale).
    const external = cents ? (cents / 100).toFixed(2) : "";
    setText((cur) => (parseMoney(cur) === cents ? cur : external));
  }, [cents]);

  return (
    <input
      id={id}
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      value={text}
      autoFocus={autoFocus}
      disabled={disabled}
      onChange={(e) => {
        if (disabled) return;
        const raw = e.target.value.replace(/[^0-9.]/g, "");
        setText(raw);
        onCentsChange(parseMoney(raw));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      onBlur={() => {
        const c = parseMoney(text);
        setText(c ? (c / 100).toFixed(2) : "");
        onCommit?.(c);
      }}
    />
  );
}
