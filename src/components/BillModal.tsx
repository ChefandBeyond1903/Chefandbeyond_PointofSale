"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { MoneyInput } from "@/components/MoneyInput";
import { BILL_TERMS, dueDateFromTerms } from "@/lib/terms";
import type { PurchaseOrder } from "@/lib/types";

type Line = {
  id: string;
  name: string;
  sku: string;
  hasProduct: boolean;
  ordered: number;
  received: number;
  now: string; // receive-now qty
  costCents: number;
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Receive items against a PO and record a vendor bill (partial receipts OK). */
export function BillModal({
  poId,
  onClose,
  onDone,
}: {
  poId: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(todayISO());
  const [terms, setTerms] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  const [memo, setMemo] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api<{ purchaseOrder: PurchaseOrder }>(`/api/purchase-orders/${poId}`);
      setPo(res.purchaseOrder);
      setLines(
        (res.purchaseOrder.items ?? []).map((it) => ({
          id: it.id,
          name: it.nameSnapshot || "—",
          sku: it.skuSnapshot,
          hasProduct: !!it.productId,
          ordered: it.quantity,
          received: it.receivedQuantity,
          now: String(Math.max(0, it.quantity - it.receivedQuantity)),
          costCents: it.unitCostCents,
        })),
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load purchase order");
    }
  }, [poId]);

  useEffect(() => {
    load();
  }, [load]);

  // Terms drive the due date until the user picks one by hand.
  useEffect(() => {
    if (dueTouched) return;
    const d = dueDateFromTerms(new Date(billDate || todayISO()), terms);
    setDueDate(d ? toISO(d) : "");
  }, [terms, billDate, dueTouched]);

  function setNow(id: string, raw: string) {
    setLines((cur) => cur.map((l) => (l.id === id ? { ...l, now: raw.replace(/[^0-9-]/g, "") } : l)));
  }
  function setCost(id: string, cents: number) {
    setLines((cur) => cur.map((l) => (l.id === id ? { ...l, costCents: cents } : l)));
  }
  function fillRemaining() {
    setLines((cur) => cur.map((l) => ({ ...l, now: String(Math.max(0, l.ordered - l.received)) })));
  }

  const total = lines.reduce((s, l) => s + (parseInt(l.now || "0", 10) || 0) * l.costCents, 0);

  async function submit() {
    const payload = lines
      .map((l) => ({
        itemId: l.id,
        receiveQty: parseInt(l.now || "0", 10) || 0,
        unitCostCents: l.costCents,
      }))
      .filter((l) => l.receiveQty !== 0);
    if (payload.length === 0) {
      setErr("Enter a quantity to receive on at least one line.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/purchase-orders/${poId}/bills`, {
        method: "POST",
        body: JSON.stringify({
          billNumber: billNumber.trim(),
          billDate,
          dueDate: dueDate || null,
          terms,
          memo: memo.trim(),
          lines: payload,
        }),
      });
      onDone?.();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the bill");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {!po ? (
          <p className="text-sm text-zinc-500">{err ?? "Loading…"}</p>
        ) : (
          <>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Receive &amp; bill · <span className="font-mono">{po.poNumber}</span>
              </h2>
              <button onClick={onClose} className="btn-ghost px-2 py-1 text-sm">
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm text-zinc-500">
              {po.vendor} — received quantities post to this store&rsquo;s inventory and the bill is
              added to Bills.
            </p>

            {err && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              <div>
                <label className="label">Bill no.</label>
                <input
                  className="input"
                  placeholder="Vendor invoice #"
                  value={billNumber}
                  onChange={(e) => setBillNumber(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Bill date</label>
                <input
                  type="date"
                  className="input"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Terms</label>
                <select
                  className="input"
                  value={terms}
                  onChange={(e) => {
                    setDueTouched(false);
                    setTerms(e.target.value);
                  }}
                >
                  <option value="">— None —</option>
                  {BILL_TERMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Due date</label>
                <input
                  type="date"
                  className="input"
                  value={dueDate}
                  onChange={(e) => {
                    setDueTouched(true);
                    setDueDate(e.target.value);
                  }}
                />
              </div>
            </div>

            {lines.length === 0 ? (
              <p className="text-sm text-zinc-400">This purchase order has no item lines.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
                    <tr>
                      <th className="py-1.5">Item</th>
                      <th className="py-1.5 text-right">Ordered</th>
                      <th className="py-1.5 text-right">In</th>
                      <th className="py-1.5 text-right">Receive</th>
                      <th className="py-1.5 text-right">Unit cost</th>
                      <th className="py-1.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {lines.map((l) => {
                      const q = parseInt(l.now || "0", 10) || 0;
                      return (
                        <tr key={l.id}>
                          <td className="py-2">
                            {l.name}
                            <span className="ml-1 text-xs text-zinc-400">{l.sku}</span>
                            {!l.hasProduct && (
                              <span className="ml-1 text-[11px] text-amber-600">
                                (no product — bill only)
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums">{l.ordered}</td>
                          <td className="py-2 text-right tabular-nums text-zinc-500">{l.received}</td>
                          <td className="py-2 text-right">
                            <input
                              className="input h-8 w-20 text-right"
                              inputMode="numeric"
                              value={l.now}
                              onChange={(e) => setNow(l.id, e.target.value)}
                            />
                          </td>
                          <td className="py-2 text-right">
                            <MoneyInput
                              cents={l.costCents}
                              onCentsChange={(c) => setCost(l.id, c)}
                              className="input h-8 w-24 text-right"
                            />
                          </td>
                          <td className="py-2 text-right font-medium tabular-nums">
                            {formatMoney(q * l.costCents)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="py-2 text-right font-medium">
                        Bill total
                      </td>
                      <td className="py-2 text-right text-base font-bold">{formatMoney(total)}</td>
                    </tr>
                  </tfoot>
                </table>
                <button onClick={fillRemaining} className="btn-ghost mt-1 text-xs text-indigo-600">
                  Fill remaining
                </button>
              </div>
            )}

            <div className="mt-4">
              <label className="label">Memo</label>
              <textarea
                className="input"
                rows={2}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>

            <div className="mt-5 flex gap-2">
              <button onClick={onClose} className="btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || lines.length === 0}
                className="btn-primary flex-1"
              >
                {busy ? "Saving…" : "Receive & save bill"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
