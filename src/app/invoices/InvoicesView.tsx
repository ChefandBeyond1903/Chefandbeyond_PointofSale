"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { usePaged } from "@/lib/usePaged";
import { Pager } from "@/components/Pager";
import { InvoiceModal } from "@/components/InvoiceModal";
import type { Sale, Store } from "@/lib/types";

type Filter = "OPEN" | "PAID" | "REFUNDED" | "ALL";

const FILTERS: { key: Filter; label: string; status?: string }[] = [
  { key: "OPEN", label: "Open", status: "INVOICED" },
  { key: "PAID", label: "Paid", status: "COMPLETED" },
  { key: "REFUNDED", label: "Refunded", status: "REFUNDED" },
  { key: "ALL", label: "All" },
];

export function InvoicesView({
  canManage = true,
  isAdmin = false,
}: {
  canManage?: boolean;
  isAdmin?: boolean;
}) {
  const [term, setTerm] = useState(""); // what's typed in the box
  const [query, setQuery] = useState(""); // what we've actually searched for
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [storeId, setStoreId] = useState(""); // "" = every store (admin only)
  const [stores, setStores] = useState<Store[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ take: "500" });
      const f = FILTERS.find((x) => x.key === filter);
      if (f?.status) qs.set("status", f.status);
      if (query.trim()) qs.set("q", query.trim());
      if (storeId) qs.set("storeId", storeId);
      const res = await api<{ sales: Sale[] }>(`/api/sales?${qs.toString()}`);
      setSales(res.sales);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [filter, query, storeId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    api<{ stores: Store[] }>("/api/stores?all=1")
      .then((r) => setStores(r.stores))
      .catch(() => {});
  }, [isAdmin]);

  // Deep links from Overview ("Balance due" / "Overdue"):
  // /invoices?status=OPEN&overdue=1.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    if (status && FILTERS.some((f) => f.key === status)) setFilter(status as Filter);
    if (params.get("overdue") === "1") {
      setOverdueOnly(true);
      if (!status) setFilter("OPEN");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isOverdue = (s: Sale) => !!s.dueDate && new Date(s.dueDate) < new Date();
  const rows = overdueOnly ? sales.filter(isOverdue) : sales;
  const pg = usePaged(rows);
  const showStore = isAdmin && !storeId; // redundant once a store is chosen
  const cols = showStore ? 6 : 5;

  return (
    <div className="w-full flex-1 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Invoices</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(term);
          }}
          className="flex items-center gap-2"
        >
          <input
            className="input w-80 max-w-full"
            placeholder="Search invoice # or customer name, company, phone, email…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <button type="submit" className="btn-primary">
            Search
          </button>
          {query && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setTerm("");
                setQuery("");
              }}
            >
              Clear
            </button>
          )}
        </form>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {isAdmin && stores.length > 0 && (
            <select
              className="input mr-1 h-8 w-auto min-w-44 text-sm"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              aria-label="Filter invoices by store"
            >
              <option value="">All stores</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === f.key
                  ? "bg-zinc-100 text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
              }`}
            >
              {f.label}
            </button>
          ))}
          <button
            onClick={() => setOverdueOnly((v) => !v)}
            className={`ml-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              overdueOnly
                ? "bg-red-100 text-red-700"
                : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
            }`}
            title="Only invoices past their due date"
          >
            Overdue
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {query && !loading && (
        <p className="mb-2 text-sm text-zinc-500">
          {pg.total} result{pg.total === 1 ? "" : "s"} for &ldquo;{query}&rdquo;
        </p>
      )}

      <Pager {...pg} className="mb-2 justify-end" />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5">#</th>
              <th className="px-4 py-2.5">Date</th>
              <th className="px-4 py-2.5">Customer</th>
              {showStore && <th className="px-4 py-2.5">Store</th>}
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={cols} className="px-4 py-8 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : pg.total === 0 ? (
              <tr>
                <td colSpan={cols} className="px-4 py-8 text-center text-zinc-400">
                  {overdueOnly ? "No overdue invoices." : "No invoices."}
                </td>
              </tr>
            ) : (
              pg.pageItems.map((s) => {
                const paid = s.amountPaidCents ?? 0;
                const refunded = s.refundedCents ?? 0;
                const balance = Math.max(0, s.totalCents - paid);
                const customer =
                  s.customerCompanySnapshot ||
                  s.customerNameSnapshot ||
                  (s.customer && "name" in s.customer ? s.customer.name : "") ||
                  "—";
                return (
                  <tr
                    key={s.id}
                    onClick={() => setOpenInvoiceId(s.id)}
                    className="cursor-pointer hover:bg-zinc-50"
                  >
                    <td className="px-4 py-2.5 font-medium">#{s.number}</td>
                    <td className="px-4 py-2.5 text-zinc-500">
                      {new Date(s.createdAt).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600">{customer}</td>
                    {showStore && (
                      <td className="px-4 py-2.5 text-zinc-400">
                        {(s.storeNameSnapshot || "").replace(/^Chef and Beyond - /, "") ||
                          "—"}
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <StatusPill
                        status={s.status}
                        balance={balance}
                        refunded={refunded}
                        total={s.totalCents}
                      />
                      {isOverdue(s) && (
                        <span className="ml-1.5 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          Overdue
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {formatMoney(s.totalCents)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {openInvoiceId && (
        <InvoiceModal
          saleId={openInvoiceId}
          onClose={() => setOpenInvoiceId(null)}
          onChanged={load}
          canManage={canManage}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

function StatusPill({
  status,
  balance,
  refunded,
  total,
}: {
  status: string;
  balance: number;
  refunded: number;
  total: number;
}) {
  let cls = "bg-zinc-100 text-zinc-600";
  let label: string = status;
  if (status === "INVOICED") {
    cls = "bg-amber-100 text-amber-800";
    label = balance > 0 ? `Owes ${formatMoney(balance)}` : "Awaiting payment";
  } else if (status === "COMPLETED") {
    if (refunded > 0 && refunded < total) {
      cls = "bg-orange-100 text-orange-800";
      label = "Part-refunded";
    } else {
      cls = "bg-green-100 text-green-700";
      label = "Paid";
    }
  } else if (status === "REFUNDED") {
    cls = "bg-zinc-200 text-zinc-700";
    label = "Refunded";
  } else if (status === "VOIDED") {
    cls = "bg-zinc-100 text-zinc-500";
    label = "Voided";
  }
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}
