"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import type { ReportSummary } from "@/lib/types";

type RangeKey = "today" | "7d" | "30d";

function rangeFor(key: RangeKey): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  if (key === "today") {
    from.setHours(0, 0, 0, 0);
  } else if (key === "7d") {
    from.setDate(from.getDate() - 7);
  } else {
    from.setDate(from.getDate() - 30);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

export function ReportsView() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("today");
  const [data, setData] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (key: RangeKey) => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = rangeFor(key);
      const res = await api<ReportSummary>(
        `/api/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(rangeKey);
  }, [load, rangeKey]);

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 p-4">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Reports</h1>
        <div className="ml-auto flex gap-1 rounded-md bg-zinc-100 p-1 text-sm">
          {(["today", "7d", "30d"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setRangeKey(k)}
              className={`rounded px-3 py-1 font-medium ${
                rangeKey === k ? "bg-white shadow-sm" : "text-zinc-500"
              }`}
            >
              {k === "today" ? "Today" : k === "7d" ? "Last 7 days" : "Last 30 days"}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading || !data ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Gross sales" value={formatMoney(data.totals.grossCents)} />
            <Stat label="Transactions" value={String(data.totals.saleCount)} />
            <Stat label="Items sold" value={String(data.totals.itemsSold)} />
            <Stat label="Avg. sale" value={formatMoney(data.totals.averageSaleCents)} />
            <Stat label="Net (pre-tax)" value={formatMoney(data.totals.subtotalCents - data.totals.discountCents)} />
            <Stat label="Tax collected" value={formatMoney(data.totals.taxCents)} />
            <Stat label="Discounts given" value={formatMoney(data.totals.discountCents)} />
            <Stat
              label="Cash / Card"
              value={
                (data.byPaymentMethod.find((m) => m.method === "CASH")?.count ?? 0) +
                " / " +
                (data.byPaymentMethod.find((m) => m.method === "CARD")?.count ?? 0)
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="mb-3 font-semibold">Top products</h2>
              {data.topProducts.length === 0 ? (
                <p className="text-sm text-zinc-400">No sales in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-zinc-100">
                    {data.topProducts.map((p) => (
                      <tr key={p.productId}>
                        <td className="py-2">{p.name}</td>
                        <td className="py-2 text-right text-zinc-500">{p.quantity} sold</td>
                        <td className="py-2 text-right font-medium">{formatMoney(p.revenueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card p-4">
              <h2 className="mb-3 font-semibold">Recent transactions</h2>
              {data.recentSales.length === 0 ? (
                <p className="text-sm text-zinc-400">No sales in this period.</p>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-zinc-100">
                      {data.recentSales.map((s) => (
                        <tr key={s.id}>
                          <td className="py-2 font-medium">#{s.number}</td>
                          <td className="py-2 text-zinc-500">
                            {new Date(s.createdAt).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="py-2 text-zinc-500">{s.cashier}</td>
                          <td className="py-2 text-right text-zinc-400">{s.itemCount} items</td>
                          <td className="py-2 text-right font-medium">{formatMoney(s.totalCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}
