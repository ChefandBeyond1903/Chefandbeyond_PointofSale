"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";
import { InvoiceModal } from "@/components/InvoiceModal";
import { ReceiptModal } from "@/components/ReceiptModal";
import { DateRangePicker } from "@/components/DateRangePicker";
import { resolvePreset, type DateRange } from "@/lib/dateRange";
import type {
  Bill,
  HeldSaleSummary,
  InventoryValuation,
  ProfitRow,
  PurchaseOrder,
  ReportSummary,
} from "@/lib/types";

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
  const [printSaleId, setPrintSaleId] = useState<string | null>(null);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [heldTickets, setHeldTickets] = useState<HeldSaleSummary[]>([]);
  const [inv, setInv] = useState<InventoryValuation | null>(null);

  const load = useCallback(
    async (from: Date, to: Date, store: string) => {
      setLoading(true);
      setError(null);
      const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      if (store) qs.set("storeId", store);
      try {
        const res = await api<ReportSummary>(`/api/reports/summary?${qs.toString()}`);
        setData(res);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load report");
      } finally {
        setLoading(false);
      }
      if (isAdmin) {
        api<{ purchaseOrders: PurchaseOrder[] }>(`/api/purchase-orders?take=100&${qs.toString()}`)
          .then((r) => setPos(r.purchaseOrders))
          .catch(() => setPos([]));
        api<{ bills: Bill[] }>(`/api/bills?${qs.toString()}`)
          .then((r) => setBills(r.bills))
          .catch(() => setBills([]));
        api<{ heldSales: HeldSaleSummary[] }>(`/api/held-sales`)
          .then((r) => setHeldTickets(r.heldSales))
          .catch(() => setHeldTickets([]));
      }
      if (!limited) {
        // Inventory valuation is a live snapshot — no date range, store only.
        const invQs = store ? `?storeId=${encodeURIComponent(store)}` : "";
        api<InventoryValuation>(`/api/reports/inventory${invQs}`)
          .then((r) => setInv(r))
          .catch(() => setInv(null));
      }
    },
    [isAdmin, limited],
  );

  const reload = useCallback(
    () => load(range.from, range.to, storeId),
    [load, range, storeId],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function del(
    kind: "invoice" | "purchase order" | "bill" | "held ticket",
    url: string,
  ) {
    if (!confirm(`Delete this ${kind}? This can't be undone.`)) return;
    try {
      await api(url, { method: "DELETE" });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not delete the ${kind}`);
    }
  }

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
                  label="Gross profit"
                  value={formatMoney(data.totals.profitCents)}
                  sub={`${data.totals.marginPct}% margin`}
                />
                <Stat label="Operating expenses" value={formatMoney(data.totals.expensesCents)} />
                <Stat
                  label="Card processing fees"
                  value={formatMoney(data.totals.cardFeeCents)}
                  sub={
                    data.totals.cardSalesCents > 0
                      ? `3% of ${formatMoney(data.totals.cardSalesCents)} card sales`
                      : "3% of card sales"
                  }
                />
                <Stat
                  label="Net profit"
                  value={formatMoney(data.totals.netProfitCents)}
                  sub="after expenses"
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

          {!limited && inv && <InventorySection inv={inv} />}

          {!limited && data.receivables.count > 0 && (
            <div className="card overflow-hidden">
              <div className="flex flex-wrap items-baseline gap-x-3 border-b border-zinc-100 px-4 py-3">
                <h2 className="font-semibold">Open invoices</h2>
                <span className="text-sm text-zinc-500">
                  {data.receivables.count} · {formatMoney(data.receivables.amountCents)} balance due
                  {data.receivables.depositsHeldCents > 0 && (
                    <> · {formatMoney(data.receivables.depositsHeldCents)} deposits held</>
                  )}
                  {data.receivables.overdueCount > 0 && (
                    <span className="text-red-600"> · {data.receivables.overdueCount} overdue</span>
                  )}
                </span>
              </div>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-zinc-100">
                    {data.unpaidInvoices.map((i) => (
                      <tr
                        key={i.id}
                        onClick={() => setOpenInvoiceId(i.id)}
                        className="cursor-pointer hover:bg-zinc-50"
                      >
                        <td className="px-4 py-2 font-medium">#{i.number}</td>
                        <td className="px-4 py-2 text-zinc-500">{i.customer || "—"}</td>
                        <td className="px-4 py-2 text-zinc-400">
                          {i.terms || "—"}
                          {i.dueDate && (
                            <span className={i.overdue ? " text-red-600" : ""}>
                              {" "}
                              · due {formatDateOnly(i.dueDate)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className="font-medium">{formatMoney(i.balanceCents)}</span>
                          {i.paidCents > 0 && (
                            <span className="block text-[11px] text-zinc-400">
                              {formatMoney(i.paidCents)} paid of {formatMoney(i.totalCents)}
                            </span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-2 py-2 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                del("invoice", `/api/sales/${i.id}`);
                              }}
                              className="btn-ghost px-2 py-0.5 text-xs text-red-500"
                              title="Delete this invoice"
                            >
                              Delete
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-4 py-2 text-xs text-zinc-400">
                Open an invoice to record its payment — it then counts as a sale for that day.
              </p>
            </div>
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
                          <td className="py-2 pl-2 text-right whitespace-nowrap">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPrintSaleId(s.id);
                              }}
                              className="btn-ghost px-2 py-0.5 text-xs text-indigo-600"
                              title="Re-print this invoice"
                            >
                              Print
                            </button>
                            {isAdmin && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  del("invoice", `/api/sales/${s.id}`);
                                }}
                                className="btn-ghost px-2 py-0.5 text-xs text-red-500"
                                title="Delete this invoice"
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {isAdmin && (
            <div className="grid gap-4 lg:grid-cols-2">
              <RecordList
                title="Purchase orders"
                empty="No purchase orders in this period."
                rows={pos.map((p) => ({
                  id: p.id,
                  head: p.poNumber,
                  sub: `${p.vendor} · ${p.status}`,
                  date: p.poDate,
                  amountCents: p.subtotalCents,
                  onDelete: () => del("purchase order", `/api/purchase-orders/${p.id}`),
                }))}
              />
              <RecordList
                title="Bills"
                empty="No bills in this period."
                rows={bills.map((b) => ({
                  id: b.id,
                  head: b.billNumber || `Bill ${b.po?.poNumber ?? ""}`.trim(),
                  sub: `${b.vendor} · ${b.status}`,
                  date: b.billDate,
                  amountCents: b.subtotalCents,
                  onDelete: () => del("bill", `/api/bills/${b.id}`),
                }))}
              />
              <RecordList
                title="Held tickets"
                empty="No held tickets."
                rows={heldTickets.map((h) => ({
                  id: h.id,
                  head: h.label || h.customerName || "Untitled ticket",
                  sub: `${h.itemCount} item${h.itemCount === 1 ? "" : "s"} · ${
                    h.salespersonName ?? h.createdByName
                  }`,
                  date: h.createdAt,
                  amountCents: h.approxTotalCents,
                  onDelete: () => del("held ticket", `/api/held-sales/${h.id}`),
                }))}
              />
            </div>
          )}

          {!limited && <ProfitLoss data={data} />}
        </div>
      )}

      {openInvoiceId && (
        <InvoiceModal
          saleId={openInvoiceId}
          onClose={() => setOpenInvoiceId(null)}
          onChanged={reload}
          canManage={!limited}
          isAdmin={isAdmin}
        />
      )}

      {printSaleId && (
        <ReceiptModal saleId={printSaleId} onClose={() => setPrintSaleId(null)} />
      )}
    </div>
  );
}

function RecordList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: {
    id: string;
    head: string;
    sub: string;
    date: string;
    amountCents: number;
    onDelete: () => void;
  }[];
}) {
  return (
    <div className="card p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">{empty}</p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2">
                    <span className="font-medium">{r.head || "—"}</span>
                    <span className="block text-xs text-zinc-400">{r.sub}</span>
                  </td>
                  <td className="py-2 text-xs text-zinc-500">
                    {new Date(r.date).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                      year: "2-digit",
                    })}
                  </td>
                  <td className="py-2 text-right font-medium">{formatMoney(r.amountCents)}</td>
                  <td className="py-2 pl-2 text-right">
                    <button
                      onClick={r.onDelete}
                      className="btn-ghost px-2 py-0.5 text-xs text-red-500"
                      title={`Delete this ${title.replace(/s$/, "").toLowerCase()}`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PLRow({
  label,
  value,
  indent,
  strong,
  border,
  negative,
}: {
  label: string;
  value: string;
  indent?: boolean;
  strong?: boolean;
  border?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 ${
        border ? "border-t border-zinc-200" : ""
      } ${strong ? "font-semibold" : ""}`}
    >
      <span className={indent ? "pl-4 text-zinc-500" : "text-zinc-600"}>{label}</span>
      <span className={`tabular-nums ${negative ? "text-red-600" : ""}`}>{value}</span>
    </div>
  );
}

function ProfitLoss({ data }: { data: ReportSummary }) {
  const t = data.totals;
  const grossSales = t.subtotalCents - t.discountCents;
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Profit &amp; loss</h2>
        <span className="text-xs text-zinc-400">
          {new Date(data.range.from).toLocaleDateString()} –{" "}
          {new Date(data.range.to).toLocaleDateString()}
        </span>
      </div>
      <div className="text-sm">
        <PLRow label="Gross sales (ex-tax)" value={formatMoney(grossSales)} />
        <PLRow
          label="Cost of goods sold"
          value={`(${formatMoney(t.costCents)})`}
          negative
        />
        <PLRow
          label="Gross profit"
          value={formatMoney(t.profitCents)}
          strong
          border
        />

        <div className="mt-3 pt-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
          Operating expenses
        </div>
        {data.expensesByCategory.length === 0 ? (
          <PLRow label="None recorded" value={formatMoney(0)} indent />
        ) : (
          data.expensesByCategory.map((e) => (
            <PLRow
              key={e.category}
              label={e.category}
              value={`(${formatMoney(e.amountCents)})`}
              indent
              negative
            />
          ))
        )}
        <PLRow
          label="Total operating expenses"
          value={`(${formatMoney(t.expensesCents)})`}
          border
          negative
        />

        <div className="mt-3 pt-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
          Card processing
        </div>
        <PLRow
          label="Credit card fees (3% of card sales)"
          value={`(${formatMoney(t.cardFeeCents)})`}
          indent
          negative
        />

        {t.refundsCents > 0 && (
          <>
            <div className="mt-3 pt-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
              Refunds
            </div>
            <PLRow
              label="Refunds issued this period"
              value={`(${formatMoney(t.refundsCents)})`}
              indent
              negative
            />
          </>
        )}

        <PLRow
          label="Net profit"
          value={formatMoney(t.netProfitCents)}
          strong
          border
        />
        {t.storeCreditOutstandingCents > 0 && (
          <p className="mt-2 text-xs text-zinc-400">
            Customers hold {formatMoney(t.storeCreditOutstandingCents)} in store credit (a
            liability, not counted above).
          </p>
        )}
      </div>
      <p className="mt-2 text-xs text-zinc-400">
        Sales tax collected ({formatMoney(t.taxCents)}) is excluded — it isn&apos;t revenue.
      </p>
    </div>
  );
}

function InventorySection({ inv }: { inv: InventoryValuation }) {
  const t = inv.totals;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (vendor: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(vendor)) next.delete(vendor);
      else next.add(vendor);
      return next;
    });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Inventory value (at cost)"
          value={formatMoney(t.costCents)}
          sub="total on-hand"
          accent
        />
        <Stat label="Retail value" value={formatMoney(t.retailCents)} sub="at selling price" />
        <Stat label="Units on hand" value={t.quantity.toLocaleString()} />
        <Stat label="Products stocked" value={String(t.productCount)} />
      </div>

      <div className="card overflow-hidden">
        <h2 className="border-b border-zinc-100 px-4 py-3 font-semibold">
          Inventory by vendor
          {!inv.scope.allStores && inv.scope.storeName ? ` — ${inv.scope.storeName}` : ""}
        </h2>
        <p className="px-4 pt-2 text-xs text-zinc-400">Click a vendor to see its products.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2">Vendor</th>
                <th className="px-4 py-2 text-right">Products</th>
                <th className="px-4 py-2 text-right">Units</th>
                <th className="px-4 py-2 text-right">Cost value</th>
                <th className="px-4 py-2 text-right">Retail value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {inv.byVendor.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-zinc-400">
                    No stock on hand.
                  </td>
                </tr>
              ) : (
                inv.byVendor.map((r) => {
                  const expanded = open.has(r.vendor);
                  return (
                    <Fragment key={r.vendor}>
                      <tr
                        onClick={() => toggle(r.vendor)}
                        className="cursor-pointer hover:bg-zinc-50"
                      >
                        <td className="px-4 py-2 font-medium">
                          <span className="mr-1 inline-block w-3 text-zinc-400">
                            {expanded ? "▾" : "▸"}
                          </span>
                          {r.vendor}
                        </td>
                        <td className="px-4 py-2 text-right text-zinc-500">{r.productCount}</td>
                        <td className="px-4 py-2 text-right text-zinc-500">
                          {r.quantity.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right font-medium">
                          {formatMoney(r.costCents)}
                        </td>
                        <td className="px-4 py-2 text-right text-zinc-500">
                          {formatMoney(r.retailCents)}
                        </td>
                      </tr>
                      {expanded &&
                        r.items.map((p) => (
                          <tr key={p.productId} className="bg-zinc-50/60 text-xs">
                            <td className="py-1.5 pl-10 pr-4 text-zinc-600">
                              {p.name}
                              <span className="ml-2 text-zinc-400">{p.sku}</span>
                            </td>
                            <td className="px-4 py-1.5"></td>
                            <td className="px-4 py-1.5 text-right text-zinc-500">
                              {p.quantity.toLocaleString()}
                            </td>
                            <td className="px-4 py-1.5 text-right text-zinc-600">
                              {formatMoney(p.costCents)}
                            </td>
                            <td className="px-4 py-1.5 text-right text-zinc-400">
                              {formatMoney(p.retailCents)}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })
              )}
            </tbody>
            {inv.byVendor.length > 0 && (
              <tfoot>
                <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right">{t.productCount}</td>
                  <td className="px-4 py-2 text-right">{t.quantity.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(t.costCents)}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(t.retailCents)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
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
