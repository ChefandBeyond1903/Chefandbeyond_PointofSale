"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { DateRangePicker } from "@/components/DateRangePicker";
import { resolvePreset, type DateRange } from "@/lib/dateRange";
import type { SalesByVendorReport as SalesByVendorReportData } from "@/lib/types";

export function SalesByVendorReport({ isAdmin }: { isAdmin: boolean }) {
  const [range, setRange] = useState<DateRange>(() => resolvePreset("this_month"));
  const [storeId, setStoreId] = useState("");
  const [data, setData] = useState<SalesByVendorReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (from: Date, to: Date, store: string) => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (store) qs.set("storeId", store);
    try {
      const res = await api<SalesByVendorReportData>(`/api/reports/sales-by-vendor?${qs.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range.from, range.to, storeId);
  }, [load, range, storeId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && data && (
          <select
            className="input h-8 w-auto min-w-56"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          >
            <option value="">All stores (combined)</option>
            {data.stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <DateRangePicker defaultPreset="this_month" onChange={(r) => setRange(r)} />
      </div>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {loading || !data ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : data.scope.noStoreAssigned ? (
        <p className="rounded bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You&apos;re not assigned to a store yet. Reports are limited to your own store — ask an
          admin to assign you.
        </p>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <h2 className="font-semibold">Sales by vendor</h2>
            <span className="text-xs text-zinc-400">
              {data.scope.allStores ? "All stores" : (data.scope.storeName ?? "")}
            </span>
          </div>
          <p className="px-4 pt-2 text-xs text-zinc-400">
            Vendor is the one snapshotted on each item at sale time. Rebate is a percentage of
            cost, set per vendor under Vendors.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2">Vendor</th>
                  <th className="px-4 py-2 text-right">Qty sold</th>
                  <th className="px-4 py-2 text-right">Total selling price</th>
                  <th className="px-4 py-2 text-right">Total cost</th>
                  <th className="px-4 py-2 text-right">Rebate %</th>
                  <th className="px-4 py-2 text-right">Rebate amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-zinc-400">
                      No sales in this period.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((r) => (
                    <tr key={r.vendor}>
                      <td className="px-4 py-2 font-medium">{r.vendor}</td>
                      <td className="px-4 py-2 text-right text-zinc-500">
                        {r.quantity.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right">{formatMoney(r.revenueCents)}</td>
                      <td className="px-4 py-2 text-right text-zinc-500">
                        {formatMoney(r.costCents)}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-500">
                        {r.rebateBps > 0 ? `${(r.rebateBps / 100).toString()}%` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-green-700">
                        {r.rebateCents > 0 ? formatMoney(r.rebateCents) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {data.rows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold">
                    <td className="px-4 py-2">Total</td>
                    <td className="px-4 py-2 text-right">{data.totals.quantity.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(data.totals.revenueCents)}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(data.totals.costCents)}</td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2 text-right text-green-700">
                      {formatMoney(data.totals.rebateCents)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
