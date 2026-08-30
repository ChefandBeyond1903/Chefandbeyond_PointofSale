"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import type { PurchaseOrder } from "@/lib/types";

type Line = {
  id: string;
  name: string;
  sku: string;
  hasProduct: boolean;
  ordered: number;
  received: number;
  now: string; // "receive now" input
};

/** Receive items against a purchase order and push them into store inventory. */
export function ReceiveModal({
  poId,
  onClose,
  onReceived,
}: {
  poId: string;
  onClose: () => void;
  onReceived?: () => void;
}) {
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ purchaseOrder: PurchaseOrder }>(`/api/purchase-orders/${poId}`);
      setPo(res.purchaseOrder);
      setLines(
        (res.purchaseOrder.items ?? []).map((it) => {
          const remaining = Math.max(0, it.quantity - it.receivedQuantity);
          return {
            id: it.id,
            name: it.nameSnapshot || "—",
            sku: it.skuSnapshot,
            hasProduct: !!it.productId,
            ordered: it.quantity,
            received: it.receivedQuantity,
            now: String(remaining),
          };
        }),
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load purchase order");
    }
  }, [poId]);

  useEffect(() => {
    load();
  }, [load]);

  function setNow(id: string, raw: string) {
    setLines((cur) =>
      cur.map((l) => (l.id === id ? { ...l, now: raw.replace(/[^0-9-]/g, "") } : l)),
    );
  }

  function receiveAllRemaining() {
    setLines((cur) =>
      cur.map((l) => ({ ...l, now: String(Math.max(0, l.ordered - l.received)) })),
    );
  }

  async function submit() {
    const payload = lines
      .map((l) => ({ itemId: l.id, receiveQty: parseInt(l.now || "0", 10) || 0 }))
      .filter((l) => l.receiveQty !== 0);
    if (payload.length === 0) {
      setErr("Nothing to receive — enter a quantity on at least one line.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/purchase-orders/${poId}/receive`, {
        method: "POST",
        body: JSON.stringify({ lines: payload }),
      });
      onReceived?.();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not receive items");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {!po ? (
          <p className="text-sm text-zinc-500">{err ?? "Loading…"}</p>
        ) : (
          <>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Receive items · <span className="font-mono">{po.poNumber}</span>
              </h2>
              <button onClick={onClose} className="btn-ghost px-2 py-1 text-sm">
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm text-zinc-500">
              {po.vendor} · order total {formatMoney(po.subtotalCents)}. Received quantities land in
              this store&rsquo;s inventory.
            </p>

            {err && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

            {lines.length === 0 ? (
              <p className="text-sm text-zinc-400">
                This purchase order has no item lines to receive.
              </p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
                    <tr>
                      <th className="py-1.5">Item</th>
                      <th className="py-1.5 text-right">Ordered</th>
                      <th className="py-1.5 text-right">Already in</th>
                      <th className="py-1.5 text-right">Receive now</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {lines.map((l) => (
                      <tr key={l.id}>
                        <td className="py-2">
                          {l.name}
                          <span className="ml-1 text-xs text-zinc-400">{l.sku}</span>
                          {!l.hasProduct && (
                            <span className="ml-1 text-[11px] text-amber-600">
                              (no product — status only)
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums">{l.ordered}</td>
                        <td className="py-2 text-right tabular-nums text-zinc-500">{l.received}</td>
                        <td className="py-2 text-right">
                          <input
                            className="input h-8 w-24 text-right"
                            inputMode="numeric"
                            value={l.now}
                            onChange={(e) => setNow(l.id, e.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  onClick={receiveAllRemaining}
                  className="btn-ghost mt-2 text-xs text-indigo-600"
                >
                  Fill remaining
                </button>
              </>
            )}

            <div className="mt-5 flex gap-2">
              <button onClick={onClose} className="btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || lines.length === 0}
                className="btn-primary flex-1"
              >
                {busy ? "Receiving…" : "Receive"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
