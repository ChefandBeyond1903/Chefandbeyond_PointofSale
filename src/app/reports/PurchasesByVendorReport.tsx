"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";
import { DateRangePicker } from "@/components/DateRangePicker";
import { resolvePreset, type DateRange } from "@/lib/dateRange";
import type {
  PurchasesByVendorReport as PurchasesByVendorReportData,
  PurchasesByVendorRow,
  PurchasesByVendorTotals,
} from "@/lib/types";

export function PurchasesByVendorReport({ isAdmin }: { isAdmin: boolean }) {
  const [range, setRange] = useState<DateRange>(() => resolvePreset("this_month"));
  const [storeId, setStoreId] = useState("");
  const [data, setData] = useState<PurchasesByVendorReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (from: Date, to: Date, store: string) => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (store) qs.set("storeId", store);
    try {
      const res = await api<PurchasesByVendorReportData>(
        `/api/reports/purchases-by-vendor?${qs.toString()}`,
      );
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
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="font-semibold">Purchases by vendor</h2>
            <span className="text-xs text-zinc-400">
              {data.scope.allStores ? "All stores" : (data.scope.storeName ?? "")}
            </span>
          </div>
          <p className="px-1 text-xs text-zinc-400">
            Paid vendor bills only — an open (unpaid) bill isn&apos;t counted, and operating
            expenses aren&apos;t included. Rebate is a percentage of amount paid, set per vendor
            under Vendors. Split below by whether the vendor is in the Strata buying group.
          </p>
          <VendorSection
            title="Strata buying group"
            rows={data.strata.rows}
            totals={data.strata.totals}
            emptyLabel="No Strata buying-group vendors paid in this period."
          />
          <VendorSection
            title="Other vendors"
            rows={data.other.rows}
            totals={data.other.totals}
            emptyLabel="No other vendors paid in this period."
          />
        </div>
      )}
    </div>
  );
}

function VendorSection({
  title,
  rows,
  totals,
  emptyLabel,
}: {
  title: string;
  rows: PurchasesByVendorRow[];
  totals: PurchasesByVendorTotals;
  emptyLabel: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(vendor: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(vendor)) next.delete(vendor);
      else next.add(vendor);
      return next;
    });
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-700">{title}</h3>
        <span className="text-xs text-zinc-400">
          {rows.length} vendor{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2">Vendor</th>
              <th className="px-4 py-2 text-right">Bills paid</th>
              <th className="px-4 py-2 text-right">Total paid</th>
              <th className="px-4 py-2 text-right">Rebate %</th>
              <th className="px-4 py-2 text-right">Rebate amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-400">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
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
                      {r.hasOpenAccount && (
                        <span
                          className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                          title="We have an active open account with this vendor"
                        >
                          Open account
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-500">{r.billCount}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(r.paidCents)}</td>
                    <td className="px-4 py-2 text-right text-zinc-500">
                      {r.rebateBps > 0 ? `${(r.rebateBps / 100).toString()}%` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-green-700">
                      {r.rebateCents > 0 ? formatMoney(r.rebateCents) : "—"}
                    </td>
                  </tr>
                  {expanded.has(r.vendor) && (
                    <tr className="bg-zinc-50/60">
                      <td colSpan={5} className="px-4 pb-3 pt-1">
                        <table className="w-full text-xs">
                          <thead className="text-left uppercase tracking-wide text-zinc-400">
                            <tr>
                              <th className="py-1 pl-5">Purchase order</th>
                              <th className="py-1">Bill #</th>
                              <th className="py-1">Due</th>
                              <th className="py-1">Paid</th>
                              <th className="py-1 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100">
                            {r.bills.map((b) => (
                              <tr key={b.id}>
                                <td className="py-1.5 pl-5">
                                  {b.poId ? (
                                    <Link
                                      href={`/purchase-orders/${b.poId}`}
                                      className="font-mono text-indigo-600 hover:underline"
                                    >
                                      {b.poNumber}
                                    </Link>
                                  ) : (
                                    <span className="text-zinc-400">No PO</span>
                                  )}
                                </td>
                                <td className="py-1.5 text-zinc-500">{b.billNumber || "—"}</td>
                                <td className="py-1.5 text-zinc-500">{formatDateOnly(b.dueDate)}</td>
                                <td className="py-1.5 text-zinc-500">
                                  {b.paidAt ? new Date(b.paidAt).toLocaleDateString() : "—"}
                                </td>
                                <td className="py-1.5 text-right font-medium">
                                  {formatMoney(b.amountCents)}
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
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold">
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right">{totals.billCount}</td>
                <td className="px-4 py-2 text-right">{formatMoney(totals.paidCents)}</td>
                <td className="px-4 py-2"></td>
                <td className="px-4 py-2 text-right text-green-700">
                  {formatMoney(totals.rebateCents)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
