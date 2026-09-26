"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { BUILTIN_PAYMENT_METHODS } from "@/lib/payments";

export type PaymentMethodOption = { code: string; label: string };

/** Loads the custom payment methods added in Settings (Zelle, Venmo, …). */
export function usePaymentMethods() {
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  useEffect(() => {
    api<{ methods: PaymentMethodOption[] }>("/api/payment-methods")
      .then((r) => setMethods(r.methods))
      .catch(() => {});
  }, []);
  return [methods, setMethods] as const;
}

/**
 * A payment-method dropdown (Cash/Card/Check + whatever's been added in
 * Settings) with an inline "Add new payment method…" escape hatch — no need
 * to leave the page to record a bill paid by something not on the list yet.
 */
export function PaymentMethodSelect({
  value,
  onChange,
  methods,
  onAdded,
  excludeCodes = ["CREDIT"],
  className = "input",
  disabled = false,
}: {
  value: string;
  onChange: (code: string) => void;
  methods: PaymentMethodOption[];
  onAdded: (m: PaymentMethodOption) => void;
  // Store credit doesn't make sense for money going OUT to a vendor — hidden
  // by default; pass [] to show every built-in.
  excludeCodes?: string[];
  className?: string;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const builtins = BUILTIN_PAYMENT_METHODS.filter((m) => !excludeCodes.includes(m.code));

  async function save() {
    const trimmed = label.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    try {
      const { method } = await api<{ method: PaymentMethodOption }>("/api/payment-methods", {
        method: "POST",
        body: JSON.stringify({ label: trimmed }),
      });
      onAdded(method);
      onChange(method.code);
      setAdding(false);
      setLabel("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add payment method");
    } finally {
      setBusy(false);
    }
  }

  if (adding) {
    return (
      <div className="space-y-1">
        {err && <p className="text-[11px] text-red-600">{err}</p>}
        <div className="flex gap-1">
          <input
            className={className}
            placeholder="e.g. Zelle"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
            autoFocus
          />
          <button
            type="button"
            onClick={save}
            disabled={busy || !label.trim()}
            className="btn-primary h-8 shrink-0 px-2 text-xs"
          >
            {busy ? "…" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setLabel("");
              setErr(null);
            }}
            className="btn-ghost h-8 shrink-0 px-2 text-xs"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <select
      className={className}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value === "__add__") setAdding(true);
        else onChange(e.target.value);
      }}
    >
      {builtins.map((m) => (
        <option key={m.code} value={m.code}>
          {m.label}
        </option>
      ))}
      {methods.map((m) => (
        <option key={m.code} value={m.code}>
          {m.label}
        </option>
      ))}
      <option value="__add__">＋ Add new payment method…</option>
    </select>
  );
}
