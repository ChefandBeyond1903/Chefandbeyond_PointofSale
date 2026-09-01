"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { InvoiceModal } from "@/components/InvoiceModal";
import { DateRangePicker } from "@/components/DateRangePicker";
import { resolvePreset, type DateRange } from "@/lib/dateRange";
import type { ProfitRow, ReportSummary } from "@/lib/types";

export function ReportsView({
  isAdmin = false,
  limited = false,
}: {
  isAdmin?: boolean;
  limited?: boolean;
}) {
  const [range, setRange] = useState<DateRange>(() => resolvePreset("today"));
  const [storeId, setStoreId] = useState<string>(""); // "" = all stores (admin only)
  const [data, setData] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);

  const load = useCallback(
    async (from: Date, to: Date, store: string) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
        if (store) qs.set("storeId", store);
        const res = await api<ReportSummary>(`/api/reports/summary?${qs.toString()}`);
        setData(res);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load report");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load(range.from, range.to, storeId);
  }, [load, range, storeId]);

  return (
    <div className="w-full flex-1 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Reports</h1>
        <span className="text-sm text-zinc-400">
          {data?.scope.allStores ? "All stores" : (data?.scope.storeName ?? "")}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
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
          <DateRangePicker defaultPreset="today" onChange={setRange} />
        </div>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading || !data ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="space-y-4">
          {!limited && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Gross sales" value={formatMoney(data.totals.grossCents)} />
                <Stat
                  label="Net (pre-tax)"
                  value={formatMoney(data.totals.subtotalCents - data.totals.discountCents)}
                />
                <Stat label="Cost of goods" value={formatMoney(data.totals.costCents)} />
                <Stat
                  label="Net profit"
                  value={formatMoney(data.totals.profitCents)}
                  sub={`${data.totals.marginPct}% margin`}
                  accent
                />
                <Stat label="Transactions" value={String(data.totals.saleCount)} />
                <Stat label="Items sold" value={String(data.totals.itemsSold)} />
                <Stat label="Tax collected" value={formatMoney(data.totals.taxCents)} />
                <Stat label="Avg. sale" value={formatMoney(data.totals.averageSaleCents)} />
              </div>

              {data.byStore.length > 1 && (
                <ProfitTable title="By store" rows={data.byStore} firstCol="Store" />
              )}

              <ProfitTable
                title="Net profit by sales staff"
                rows={data.byStaff}
                firstCol="Sales staff"
              />
            </>
          )}

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
              <h2 className="mb-3 font-semibold">Invoices</h2>
              <p className="mb-2 text-xs text-zinc-400">
                Every completed sale is an invoice. Open one to raise purchase orders by vendor.
              </p>
              {data.recentSales.length === 0 ? (
                <p className="text-sm text-zinc-400">No sales in this period.</p>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-zinc-100">
                      {data.recentSales.map((s) => (
                        <tr
                          key={s.id}
                          onClick={() => setOpenInvoiceId(s.id)}
                          className="cursor-pointer hover:bg-zinc-50"
                        >
                          <td className="py-2 font-medium">#{s.number}</td>
                          <td className="py-2 text-zinc-500">
                            {new Date(s.createdAt).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          {data.scope.allStores && (
                            <td className="py-2 text-zinc-400">{s.store}</td>
                          )}
                          <td className="py-2 text-zinc-500">{s.customer || s.salesperson}</td>
                          {!limited && (
                            <td className="py-2 text-right text-green-600">
                              {formatMoney(s.profitCents)}
                            </td>
                          )}
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

      {openInvoiceId && (
        <InvoiceModal
          saleId={openInvoiceId}
          onClose={() => setOpenInvoiceId(null)}
          canManage={!limited}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={`card p-4 ${accent ? "ring-1 ring-indigo-200" : ""}`}>
      <p className="text-xs uppercase tracking-wide text-zinc-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${accent ? "text-indigo-700" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

function ProfitTable({
  title,
  rows,
  firstCol,
}: {
  title: string;
  rows: ProfitRow[];
  firstCol: string;
}) {
  return (
    <div className="card overflow-hidden">
      <h2 className="border-b border-zinc-100 px-4 py-3 font-semibold">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-4 py-2">{firstCol}</th>
            <th className="px-4 py-2 text-right">Sales</th>
            <th className="px-4 py-2 text-right">Net (pre-tax)</th>
            <th className="px-4 py-2 text-right">Cost</th>
            <th className="px-4 py-2 text-right">Profit</th>
            <th className="px-4 py-2 text-right">Margin</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-zinc-400">
                No sales in this period.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key}>
                <td className="px-4 py-2 font-medium">{r.label}</td>
                <td className="px-4 py-2 text-right text-zinc-500">{r.saleCount}</td>
                <td className="px-4 py-2 text-right">{formatMoney(r.netCents)}</td>
                <td className="px-4 py-2 text-right text-zinc-500">{formatMoney(r.costCents)}</td>
                <td className="px-4 py-2 text-right font-semibold text-green-700">
                  {formatMoney(r.profitCents)}
                </td>
                <td className="px-4 py-2 text-right text-zinc-500">{r.marginPct}%</td>
              </tr>
            ))
          )}
        </tbody>
        </table>
      </div>
    </div>
  );
}
