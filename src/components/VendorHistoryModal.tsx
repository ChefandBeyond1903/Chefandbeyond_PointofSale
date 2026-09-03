"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import type { Bill, PurchaseOrder } from "@/lib/types";

function fmtDate(s: string | null | undefined) {
  // PO / bill / due dates are whole calendar days — format in UTC.
  return s ? new Date(s).toLocaleDateString(undefined, { timeZone: "UTC" }) : "—";
}

/** Read-only history for one vendor: their purchase orders and vendor bills. */
export function VendorHistoryModal({
  vendorName,
  onClose,
}: {
  vendorName: string;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const v = encodeURIComponent(vendorName);
      const [poRes, billRes] = await Promise.all([
        api<{ purchaseOrders: PurchaseOrder[] }>(`/api/purchase-orders?vendor=${v}&take=500`),
        api<{ bills: Bill[] }>(`/api/bills?vendor=${v}`),
      ]);
      setPos(poRes.purchaseOrders);
      setBills(billRes.bills);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load vendor history");
    } finally {
      setLoading(false);
    }
  }, [vendorName]);

  useEffect(() => {
    load();
  }, [load]);

  const poTotal = pos.reduce((s, p) => s + p.subtotalCents, 0);
  const billedTotal = bills.reduce((s, b) => s + b.subtotalCents, 0);
  const openTotal = bills
    .filter((b) => b.status === "OPEN")
    .reduce((s, b) => s + b.subtotalCents, 0);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            History · <span className="font-normal">{vendorName}</span>
          </h2>
          <button onClick={onClose} className="btn-ghost px-2 py-1 text-sm">
            ✕
          </button>
        </div>

        {err && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
        {loading ? (
          <p className="py-8 text-center text-sm text-zinc-400">Loading…</p>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Purchase orders" value={String(pos.length)} />
              <Stat label="Ordered" value={formatMoney(poTotal)} />
              <Stat label="Bills" value={String(bills.length)} />
              <Stat label="Billed" value={formatMoney(billedTotal)} />
            </div>
            {openTotal > 0 && (
              <p className="mb-4 text-sm text-amber-700">
                Open bill balance: <span className="font-medium">{formatMoney(openTotal)}</span>
              </p>
            )}

            <h3 className="mb-1.5 text-sm font-semibold">Purchase orders</h3>
            <div className="mb-5 overflow-x-auto rounded-md border border-zinc-200">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">PO no.</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {pos.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                        No purchase orders for this vendor.
                      </td>
                    </tr>
                  ) : (
                    pos.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 font-medium">
                          <Link
                            href={`/purchase-orders/${p.id}`}
                            className="text-indigo-600 hover:underline"
                          >
                            {p.poNumber}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-zinc-500">{fmtDate(p.poDate)}</td>
                        <td className="px-3 py-2 text-zinc-500">{p.status}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatMoney(p.subtotalCents)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <h3 className="mb-1.5 text-sm font-semibold">Bills</h3>
            <div className="overflow-x-auto rounded-md border border-zinc-200">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Bill no.</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Due</th>
                    <th className="px-3 py-2">PO</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {bills.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-zinc-400">
                        No bills for this vendor.
                      </td>
                    </tr>
                  ) : (
                    bills.map((b) => (
                      <tr key={b.id}>
                        <td className="px-3 py-2 font-medium">{b.billNumber || "—"}</td>
                        <td className="px-3 py-2 text-zinc-500">{fmtDate(b.billDate)}</td>
                        <td className="px-3 py-2 text-zinc-500">{fmtDate(b.dueDate)}</td>
                        <td className="px-3 py-2 text-zinc-500">
                          {b.po ? (
                            <Link
                              href={`/purchase-orders/${b.po.id}`}
                              className="text-indigo-600 hover:underline"
                            >
                              {b.po.poNumber}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              b.status === "OPEN" ? "text-amber-700" : "text-green-700"
                            }
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatMoney(b.subtotalCents)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="mt-5 flex">
          <button onClick={onClose} className="btn-secondary ml-auto">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
