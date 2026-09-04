"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";
import { usePaged } from "@/lib/usePaged";
import { Pager } from "@/components/Pager";
import { InvoiceModal } from "@/components/InvoiceModal";
import { SaleStatusPill } from "@/components/SaleStatusPill";
import { Badge } from "@/components/Badge";
import { ListHeader, SearchBox, FilterChips, FilterToggle } from "@/components/ListToolbar";
import { LoadingRow, EmptyRow } from "@/components/TableState";
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
  // /invoices?status=OPEN&overdue=1. Or from a related record (a purchase
  // order raised from this invoice, a customer's history, …):
  // /invoices?open=<id> opens that invoice directly.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    if (status && FILTERS.some((f) => f.key === status)) setFilter(status as Filter);
    if (params.get("overdue") === "1") {
      setOverdueOnly(true);
      if (!status) setFilter("OPEN");
    }
    const open = params.get("open");
    if (open) {
      setOpenInvoiceId(open);
      window.history.replaceState(null, "", "/invoices");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isOverdue = (s: Sale) => !!s.dueDate && new Date(s.dueDate) < new Date();
  const rows = overdueOnly ? sales.filter(isOverdue) : sales;
  const pg = usePaged(rows);
  const showStore = isAdmin && !storeId; // redundant once a store is chosen
  const cols = showStore ? 7 : 6;

  return (
    <div className="w-full flex-1 p-4">
      <ListHeader title="Invoices">
        <SearchBox
          mode="submit"
          value={term}
          onChange={setTerm}
          onSubmit={setQuery}
          placeholder="Search invoice #, serial number, or customer name, company, phone, email…"
        />
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
          <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
          <FilterToggle
            active={overdueOnly}
            onClick={() => setOverdueOnly((v) => !v)}
            tone="warn"
            title="Only invoices past their due date"
          >
            Overdue
          </FilterToggle>
        </div>
      </ListHeader>

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
              <th className="px-4 py-2.5">Due</th>
              <th className="px-4 py-2.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <LoadingRow colSpan={cols} />
            ) : pg.total === 0 ? (
              <EmptyRow colSpan={cols}>
                {overdueOnly ? "No overdue invoices." : "No invoices."}
              </EmptyRow>
            ) : (
              pg.pageItems.map((s) => {
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
                      <SaleStatusPill
                        status={s.status}
                        totalCents={s.totalCents}
                        amountPaidCents={s.amountPaidCents}
                        refundedCents={s.refundedCents}
                      />
                      {isOverdue(s) && (
                        <Badge tone="red" className="ml-1.5">
                          Overdue
                        </Badge>
                      )}
                    </td>
                    <td
                      className={`px-4 py-2.5 whitespace-nowrap ${
                        isOverdue(s) ? "font-medium text-red-600" : "text-zinc-500"
                      }`}
                    >
                      {s.dueDate ? formatDateOnly(s.dueDate) : "—"}
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
