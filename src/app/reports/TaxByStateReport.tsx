"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { DateRangePicker } from "@/components/DateRangePicker";
import { resolvePreset, type DateRange } from "@/lib/dateRange";
import type { TaxByStateReport as TaxByStateReportData } from "@/lib/types";

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function money(cents: number) {
  return (cents / 100).toFixed(2);
}

export function TaxByStateReport({ isAdmin }: { isAdmin: boolean }) {
  const [range, setRange] = useState<DateRange>(() => resolvePreset("this_month"));
  const [rangeLabel, setRangeLabel] = useState("This month");
  const [storeId, setStoreId] = useState("");
  const [data, setData] = useState<TaxByStateReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (from: Date, to: Date, store: string) => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (store) qs.set("storeId", store);
    try {
      const res = await api<TaxByStateReportData>(`/api/reports/tax-by-state?${qs.toString()}`);
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

  function exportKy() {
    if (!data) return;
    const period = `${new Date(data.range.from).toLocaleDateString()} - ${new Date(data.range.to).toLocaleDateString()}`;
    downloadCsv(`kentucky-dor-report-${range.from.toISOString().slice(0, 10)}.csv`, [
      ["Kentucky DOR sales & use tax report"],
      ["Period", period],
      ["Store", data.scope.allStores ? "All stores" : (data.scope.storeName ?? "")],
      [],
      ["Gross sales", "Taxable sales", "Tax collected (6%)", "Transactions"],
      [money(data.ky.grossSalesCents), money(data.ky.taxableSalesCents), money(data.ky.taxCollectedCents), data.ky.saleCount],
      [],
      ["This is a working report for filing — not an official DOR upload file."],
    ]);
  }

  function exportTn() {
    if (!data) return;
    const period = `${new Date(data.range.from).toLocaleDateString()} - ${new Date(data.range.to).toLocaleDateString()}`;
    downloadCsv(`tennessee-tntap-report-${range.from.toISOString().slice(0, 10)}.csv`, [
      ["Tennessee TNTAP sales & use tax report"],
      ["Period", period],
      ["Store", data.scope.allStores ? "All stores" : (data.scope.storeName ?? "")],
      [],
      ["Gross sales", "Taxable sales", "Tax collected (9.75%)", "Transactions"],
      [money(data.tn.grossSalesCents), money(data.tn.taxableSalesCents), money(data.tn.taxCollectedCents), data.tn.saleCount],
      [],
      ["This is a working report for filing — not an official TNTAP upload file."],
    ]);
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
        <DateRangePicker
          defaultPreset="this_month"
          onChange={(r, l) => {
            setRange(r);
            setRangeLabel(l);
          }}
        />
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
        <>
          <p className="text-xs text-zinc-400">
            Jurisdiction is tagged on each sale at the register — Kentucky by default, Tennessee
            when a seller delivery goes there, or whatever staff manually set. {rangeLabel}.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
                <h2 className="font-semibold">Kentucky (6%)</h2>
                <button onClick={exportKy} className="btn-secondary h-7 px-2 text-xs">
                  Export DOR report (CSV)
                </button>
              </div>
              <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
                <Stat label="Gross sales" value={formatMoney(data.ky.grossSalesCents)} />
                <Stat label="Taxable sales" value={formatMoney(data.ky.taxableSalesCents)} />
                <Stat label="Tax collected" value={formatMoney(data.ky.taxCollectedCents)} />
                <Stat label="Transactions" value={String(data.ky.saleCount)} />
              </dl>
            </div>
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
                <h2 className="font-semibold">Tennessee (9.75%)</h2>
                <button onClick={exportTn} className="btn-secondary h-7 px-2 text-xs">
                  Export TNTAP report (CSV)
                </button>
              </div>
              <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
                <Stat label="Gross sales" value={formatMoney(data.tn.grossSalesCents)} />
                <Stat label="Taxable sales" value={formatMoney(data.tn.taxableSalesCents)} />
                <Stat label="Tax collected" value={formatMoney(data.tn.taxCollectedCents)} />
                <Stat label="Transactions" value={String(data.tn.saleCount)} />
              </dl>
            </div>
          </div>

          {data.unassigned.saleCount > 0 && (
            <p className="rounded bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
              {data.unassigned.saleCount} sale(s) totaling {formatMoney(data.unassigned.grossSalesCents)}{" "}
              in this period carry no KY/TN jurisdiction tag (rung at a store outside that scheme, or
              before this feature existed) and aren&apos;t counted above.
            </p>
          )}

          <div className="card overflow-hidden">
            <h2 className="border-b border-zinc-100 px-4 py-3 font-semibold">
              Manual tax jurisdiction overrides
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-2">Sale</th>
                    <th className="px-4 py-2">When</th>
                    <th className="px-4 py-2">Changed by</th>
                    <th className="px-4 py-2">From → To</th>
                    <th className="px-4 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {data.overrides.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-zinc-400">
                        No manual overrides in this period.
                      </td>
                    </tr>
                  ) : (
                    data.overrides.map((o) => (
                      <tr key={o.id}>
                        <td className="px-4 py-2 font-medium">
                          {o.sale ? `#${o.sale.number}` : "—"}
                        </td>
                        <td className="px-4 py-2 text-zinc-500">
                          {new Date(o.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-zinc-500">{o.changedBy?.name ?? "—"}</td>
                        <td className="px-4 py-2">
                          {o.fromJurisdiction || "—"} → {o.toJurisdiction}
                        </td>
                        <td className="px-4 py-2 text-zinc-500">{o.reason || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="text-lg font-bold">{value}</dd>
    </div>
  );
}
