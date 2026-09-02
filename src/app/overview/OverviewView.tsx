"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import type { AdminOverview, OverviewWindow } from "@/lib/types";

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OverviewView() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<AdminOverview>("/api/overview");
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load the overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="w-full flex-1 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Overview</h1>
        {data && (
          <span className="text-xs text-zinc-400">
            as of {fmtDateTime(data.generatedAt)}
          </span>
        )}
        <button onClick={load} className="btn-ghost ml-auto text-xs" disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!data ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="space-y-4">
          {/* Headline numbers */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Sales today" value={formatMoney(data.sales.today.grossCents)}
              sub={`${data.sales.today.count} sale${data.sales.today.count === 1 ? "" : "s"}`} />
            <Kpi label="Sales this week" value={formatMoney(data.sales.week.grossCents)}
              sub={`${data.sales.week.count} sale${data.sales.week.count === 1 ? "" : "s"}`} />
            <Kpi label="Sales this month" value={formatMoney(data.sales.month.grossCents)}
              sub={`${data.sales.month.count} sale${data.sales.month.count === 1 ? "" : "s"}`} />
            <Kpi
              label="Net profit (month)"
              value={formatMoney(data.month.netProfitCents)}
              sub="after expenses"
              accent
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Sales windows */}
            <Card title="Sales" href="/reports" hrefLabel="Reports">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
                  <tr>
                    <th className="py-1.5">Period</th>
                    <th className="py-1.5 text-right">Sales</th>
                    <th className="py-1.5 text-right">Gross</th>
                    <th className="py-1.5 text-right">Gross profit</th>
                    <th className="py-1.5 text-right">Items</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  <SalesRow label="Today" w={data.sales.today} />
                  <SalesRow label="This week" w={data.sales.week} />
                  <SalesRow label="This month" w={data.sales.month} />
                </tbody>
              </table>
              <div className="mt-3 space-y-1 border-t border-zinc-100 pt-2 text-sm">
                <Line label="Gross profit (month)" value={formatMoney(data.sales.month.profitCents)} />
                <Line label="Operating expenses (month)" value={`(${formatMoney(data.month.expensesCents)})`} negative />
                <Line label="Net profit (month)" value={formatMoney(data.month.netProfitCents)} strong />
              </div>
            </Card>

            {/* Money owed */}
            <Card title="Money owed" href="/bills" hrefLabel="Bills">
              <dl className="grid grid-cols-3 gap-3 text-center">
                <Metric label="Open bills" value={String(data.payables.openBills.count)}
                  sub={formatMoney(data.payables.openBills.amountCents)} />
                <Metric label="Overdue" value={String(data.payables.overdueBills.count)}
                  sub={formatMoney(data.payables.overdueBills.amountCents)}
                  danger={data.payables.overdueBills.count > 0} />
                <Metric label="Open POs" value={String(data.payables.openPurchaseOrders)} />
              </dl>
            </Card>

            {/* Operations */}
            <Card title="Operations">
              <dl className="grid grid-cols-3 gap-3 text-center">
                <LinkMetric href="/" label="Held tickets" value={String(data.operations.heldTickets)} />
                <LinkMetric href="/inventory" label="Out of stock" value={String(data.operations.outOfStock)}
                  danger={data.operations.outOfStock > 0} />
                <LinkMetric href="/products" label="Active products"
                  value={String(data.operations.activeProducts)}
                  sub={`${data.operations.totalProducts} total`} />
              </dl>
            </Card>

            {/* Directory */}
            <Card title="Directory">
              <dl className="grid grid-cols-4 gap-3 text-center">
                <LinkMetric href="/vendors" label="Vendors" value={String(data.directory.vendors)} />
                <LinkMetric href="/customers" label="Customers" value={String(data.directory.customers)} />
                <LinkMetric href="/users" label="Staff" value={String(data.directory.staff)} />
                <LinkMetric href="/settings" label="Stores" value={String(data.directory.stores)} />
              </dl>
            </Card>

            {/* By store */}
            <Card title="By store — this month">
              {data.byStore.length === 0 ? (
                <p className="text-sm text-zinc-400">No sales this month.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
                    <tr>
                      <th className="py-1.5">Store</th>
                      <th className="py-1.5 text-right">Gross</th>
                      <th className="py-1.5 text-right">Gross profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {data.byStore.map((s) => (
                      <tr key={s.label}>
                        <td className="py-1.5">{s.label}</td>
                        <td className="py-1.5 text-right">{formatMoney(s.grossCents)}</td>
                        <td className="py-1.5 text-right font-medium text-green-700">
                          {formatMoney(s.profitCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            {/* Top products */}
            <Card title="Top products — this month">
              {data.topProducts.length === 0 ? (
                <p className="text-sm text-zinc-400">No sales this month.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-zinc-100">
                    {data.topProducts.map((p) => (
                      <tr key={p.productId}>
                        <td className="py-1.5">{p.name}</td>
                        <td className="py-1.5 text-right text-zinc-500">{p.quantity} sold</td>
                        <td className="py-1.5 text-right font-medium">{formatMoney(p.revenueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            {/* Recent sales */}
            <Card title="Recent sales" href="/reports" hrefLabel="All">
              {data.recentSales.length === 0 ? (
                <p className="text-sm text-zinc-400">No sales yet.</p>
              ) : (
                <ul className="divide-y divide-zinc-100 text-sm">
                  {data.recentSales.map((s) => (
                    <li key={s.id} className="flex items-center justify-between py-1.5">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">#{s.number}</span>{" "}
                        <span className="text-zinc-400">{s.who}</span>
                        {s.store && <span className="text-zinc-400"> · {s.store}</span>}
                      </span>
                      <span className="ml-2 shrink-0 text-right">
                        <span className="font-medium">{formatMoney(s.totalCents)}</span>
                        <span className="ml-2 text-xs text-zinc-400">{fmtDateTime(s.createdAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Recent expenses */}
            <Card title="Recent expenses" href="/bills" hrefLabel="All">
              {data.recentExpenses.length === 0 ? (
                <p className="text-sm text-zinc-400">No expenses recorded.</p>
              ) : (
                <ul className="divide-y divide-zinc-100 text-sm">
                  {data.recentExpenses.map((e) => (
                    <li key={e.id} className="flex items-center justify-between py-1.5">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{e.category}</span>
                        {e.payee && <span className="text-zinc-400"> · {e.payee}</span>}
                        <span className="text-zinc-400"> · {e.store}</span>
                      </span>
                      <span className="ml-2 shrink-0 text-right">
                        <span className="font-medium">{formatMoney(e.amountCents)}</span>
                        <span className="ml-2 text-xs text-zinc-400">
                          {new Date(e.expenseDate).toLocaleDateString()}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({
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

function Card({
  title,
  href,
  hrefLabel,
  children,
}: {
  title: string;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {href && (
          <Link href={href} className="text-xs font-medium text-indigo-600 hover:underline">
            {hrefLabel ?? "Open"} →
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function SalesRow({ label, w }: { label: string; w: OverviewWindow }) {
  return (
    <tr>
      <td className="py-1.5">{label}</td>
      <td className="py-1.5 text-right text-zinc-500">{w.count}</td>
      <td className="py-1.5 text-right">{formatMoney(w.grossCents)}</td>
      <td className="py-1.5 text-right font-medium text-green-700">{formatMoney(w.profitCents)}</td>
      <td className="py-1.5 text-right text-zinc-500">{w.itemsSold}</td>
    </tr>
  );
}

function Line({
  label,
  value,
  strong,
  negative,
}: {
  label: string;
  value: string;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${strong ? "font-semibold" : ""}`}>
      <span className="text-zinc-500">{label}</span>
      <span className={negative ? "text-red-600" : ""}>{value}</span>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  danger,
}: {
  label: string;
  value: string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className={`text-lg font-bold ${danger ? "text-red-600" : ""}`}>{value}</dd>
      {sub && <dd className="text-xs text-zinc-400">{sub}</dd>}
    </div>
  );
}

function LinkMetric({
  href,
  label,
  value,
  sub,
  danger,
}: {
  href: string;
  label: string;
  value: string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <Link href={href} className="rounded-md p-1 hover:bg-zinc-50">
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className={`text-lg font-bold ${danger ? "text-red-600" : ""}`}>{value}</dd>
      {sub && <dd className="text-xs text-zinc-400">{sub}</dd>}
    </Link>
  );
}
