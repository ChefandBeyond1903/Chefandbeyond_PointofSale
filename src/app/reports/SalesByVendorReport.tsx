"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  function toggle(vendor: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(vendor)) next.delete(vendor);
      else next.add(vendor);
      return next;
    });
  }

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
            Vendor is the one snapshotted on each item at sale time — except an item rung before
            its product had a vendor at all, which picks up the product&apos;s current vendor.
            Click a row to see which items make it up; rebate is a percentage of cost, set per
            vendor under Vendors.
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
                    <Fragment key={r.vendor}>
                      <tr
                        onClick={() => toggle(r.vendor)}
                        className="cursor-pointer hover:bg-zinc-50"
                        aria-expanded={expanded.has(r.vendor)}
                      >
                        <td className="px-4 py-2 font-medium">
                          <span className="mr-1.5 inline-block w-3 text-xs text-zinc-400">
                            {expanded.has(r.vendor) ? "▾" : "▸"}
                          </span>
                          {r.vendor}
                        </td>
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
                      {expanded.has(r.vendor) && (
                        <tr className="bg-zinc-50/60">
                          <td colSpan={6} className="px-4 pb-3 pt-1">
                            {r.vendor === "Unassigned" && (
                              <p className="mb-2 pl-5 text-xs text-amber-700">
                                These items had no vendor on the product at sale time. Set a
                                vendor on the product (under Products) and it&apos;ll count toward
                                that vendor from here on — this report reflects the vendor
                                snapshotted when the sale happened, so earlier sales of an item
                                that already had a vendor don&apos;t move if you change the
                                product&apos;s vendor later.
                              </p>
                            )}
                            <table className="w-full text-xs">
                              <thead className="text-left uppercase tracking-wide text-zinc-400">
                                <tr>
                                  <th className="py-1 pl-5">Product</th>
                                  <th className="py-1">SKU</th>
                                  <th className="py-1 text-right">Qty sold</th>
                                  <th className="py-1 text-right">Revenue</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-100">
                                {r.items.map((i) => (
                                  <tr key={i.productId}>
                                    <td className="py-1.5 pl-5">
                                      <Link
                                        href={`/products?open=${i.productId}`}
                                        className="text-indigo-600 hover:underline"
                                      >
                                        {i.name}
                                      </Link>
                                      {i.excludedFromRebate && (
                                        <span
                                          className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                                          title="This item's cost isn't counted in the vendor's rebate"
                                        >
                                          no rebate
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-1.5 font-mono text-zinc-500">{i.sku}</td>
                                    <td className="py-1.5 text-right tabular-nums">
                                      {i.quantity.toLocaleString()}
                                    </td>
                                    <td className="py-1.5 text-right font-medium">
                                      {formatMoney(i.revenueCents)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
