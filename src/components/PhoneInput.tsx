"use client";

import { formatPhone } from "@/lib/phone";

/** Text input that formats a phone number as (615)870-4844 while you type. */
export function PhoneInput({
  value,
  onChange,
  className = "input",
  placeholder = "(615)870-4844",
  disabled,
}: {
  value: string;
  onChange: (formatted: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="tel"
      inputMode="tel"
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(formatPhone(e.target.value))}
      onBlur={(e) => onChange(formatPhone(e.target.value))}
    />
  );
}
