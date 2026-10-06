"use client";

import { useState } from "react";
import { MoneyInput } from "@/components/MoneyInput";
import { formatMoney } from "@/lib/money";
import { earlyPayDiscountCents, processingFeePctCents } from "@/lib/billFees";

export type BillAdjustmentValues = {
  shippingCents: number;
  minOrderFeeCents: number;
  dropShipFeeCents: number;
  processingFeeBps: number;
  processingFeeCents: number;
  earlyPayDiscountBps: number;
  vendorCreditCents: number;
};

/**
 * Fees (shipping, minimum order, drop ship — booked as operating expenses),
 * plus the early-pay discount % and vendor credit that reduce what's owed.
 */
export function BillAdjustments({
  values,
  onChange,
  itemsCents,
  disabled,
}: {
  values: BillAdjustmentValues;
  onChange: (next: BillAdjustmentValues) => void;
  itemsCents: number;
  disabled?: boolean;
}) {
  const set = (patch: Partial<BillAdjustmentValues>) => onChange({ ...values, ...patch });
  const [pctText, setPctText] = useState(
    values.earlyPayDiscountBps ? String(values.earlyPayDiscountBps / 100) : "",
  );
  const discountCents = earlyPayDiscountCents(itemsCents, values.earlyPayDiscountBps);
  const [feeMode, setFeeMode] = useState<"flat" | "pct">(values.processingFeeBps > 0 ? "pct" : "flat");
  const [feePctText, setFeePctText] = useState(
    values.processingFeeBps ? String(values.processingFeeBps / 100) : "",
  );
  const cls = "input h-8 text-right";

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <div>
        <label className="label">Shipping cost</label>
        <MoneyInput
          cents={values.shippingCents}
          onCentsChange={(c) => set({ shippingCents: c })}
          disabled={disabled}
          className={cls}
        />
      </div>
      <div>
        <label className="label">Minimum order fee</label>
        <MoneyInput
          cents={values.minOrderFeeCents}
          onCentsChange={(c) => set({ minOrderFeeCents: c })}
          disabled={disabled}
          className={cls}
        />
      </div>
      <div>
        <label className="label">Drop ship fee</label>
        <MoneyInput
          cents={values.dropShipFeeCents}
          onCentsChange={(c) => set({ dropShipFeeCents: c })}
          disabled={disabled}
          className={cls}
        />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label className="label">Processing fee</label>
          <div className="mb-1 flex gap-0.5 rounded bg-zinc-100 p-0.5 text-[11px]">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setFeeMode("flat");
                set({ processingFeeBps: 0 });
              }}
              className={`rounded px-1.5 py-0.5 font-medium ${
                feeMode === "flat" ? "bg-white shadow-sm" : "text-zinc-500"
              }`}
            >
              $
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setFeeMode("pct")}
              className={`rounded px-1.5 py-0.5 font-medium ${
                feeMode === "pct" ? "bg-white shadow-sm" : "text-zinc-500"
              }`}
            >
              %
            </button>
          </div>
        </div>
        {feeMode === "flat" ? (
          <MoneyInput
            cents={values.processingFeeCents}
            onCentsChange={(c) => set({ processingFeeCents: c })}
            disabled={disabled}
            className={cls}
          />
        ) : (
          <input
            className={cls}
            inputMode="decimal"
            placeholder="0"
            disabled={disabled}
            value={feePctText}
            onChange={(e) => {
              const t = e.target.value.replace(/[^0-9.]/g, "");
              setFeePctText(t);
              const pct = Math.min(100, Number.parseFloat(t) || 0);
              const bps = Math.round(pct * 100);
              set({ processingFeeBps: bps, processingFeeCents: processingFeePctCents(itemsCents, bps) });
            }}
          />
        )}
        <p className="mt-0.5 text-[11px] text-zinc-400">
          Card/payment processing cost, as a flat $ or a % of the items
          {feeMode === "pct" && values.processingFeeCents > 0
            ? ` — ${formatMoney(values.processingFeeCents)}`
            : ""}
          .
        </p>
      </div>
      <div>
        <label className="label">Early-pay discount %</label>
        <input
          className={cls}
          inputMode="decimal"
          placeholder="0"
          disabled={disabled}
          value={pctText}
          onChange={(e) => {
            const t = e.target.value.replace(/[^0-9.]/g, "");
            setPctText(t);
            const pct = Math.min(100, Number.parseFloat(t) || 0);
            set({ earlyPayDiscountBps: Math.round(pct * 100) });
          }}
        />
        <p className="mt-0.5 text-[11px] text-zinc-400">
          Extra off the items when paid on time (e.g. Net 15)
          {discountCents > 0 ? ` — saves ${formatMoney(discountCents)}` : ""}.
        </p>
      </div>
      <div>
        <label className="label">Vendor credit</label>
        <MoneyInput
          cents={values.vendorCreditCents}
          onCentsChange={(c) => set({ vendorCreditCents: c })}
          disabled={disabled}
          className={cls}
        />
        <p className="mt-0.5 text-[11px] text-zinc-400">Credit applied against this bill.</p>
      </div>
      <p className="text-[11px] text-zinc-400 sm:col-span-3">
        Shipping, minimum order, drop ship and processing fees are recorded as operating
        expenses. Vendor credit and the discount only reduce the bill.
      </p>
    </div>
  );
}
