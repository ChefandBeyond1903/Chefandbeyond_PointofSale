"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { usePaged } from "@/lib/usePaged";
import { Pager } from "@/components/Pager";
import { QuoteModal } from "@/components/QuoteModal";
import type { Quote, QuoteStatus, Store } from "@/lib/types";

type Filter = QuoteStatus | "ALL";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "OPEN", label: "Open" },
  { key: "APPROVED", label: "Approved" },
  { key: "CONVERTED", label: "Converted" },
  { key: "REJECTED", label: "Rejected" },
  { key: "ALL", label: "All" },
];

export function QuotesView({
  canManage = true,
  isAdmin = false,
}: {
  canManage?: boolean;
  isAdmin?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [storeId, setStoreId] = useState(""); // "" = every store (admin only)
  const [stores, setStores] = useState<Store[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openQuoteId, setOpenQuoteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ take: "500" });
      if (filter !== "ALL") qs.set("status", filter);
      if (query.trim()) qs.set("q", query.trim());
      if (storeId) qs.set("storeId", storeId);
      const res = await api<{ quotes: Quote[] }>(`/api/quotes?${qs.toString()}`);
      setQuotes(res.quotes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load quotes");
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

  const pg = usePaged(quotes);
  const showStore = isAdmin && !storeId;
  const cols = showStore ? 6 : 5;

  return (
    <div className="w-full flex-1 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Quotes</h1>
        <Link href="/" className="btn-secondary">
          Build a quote
        </Link>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(term);
          }}
          className="flex items-center gap-2"
        >
          <input
            className="input w-72 max-w-full"
            placeholder="Search quote # or customer…"
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
              aria-label="Filter quotes by store"
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
        </div>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
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
                  No quotes.
                </td>
              </tr>
            ) : (
              pg.pageItems.map((q) => {
                const customer =
                  q.customerCompanySnapshot ||
                  q.customerNameSnapshot ||
                  (q.customer && "name" in q.customer ? q.customer.name : "") ||
                  "—";
                return (
                  <tr
                    key={q.id}
                    onClick={() => setOpenQuoteId(q.id)}
                    className="cursor-pointer hover:bg-zinc-50"
                  >
                    <td className="px-4 py-2.5 font-medium">Q-{q.number}</td>
                    <td className="px-4 py-2.5 text-zinc-500">
                      {new Date(q.createdAt).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600">{customer}</td>
                    {showStore && (
                      <td className="px-4 py-2.5 text-zinc-400">
                        {(q.storeNameSnapshot || "").replace(/^Chef and Beyond - /, "") || "—"}
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <StatusPill status={q.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {formatMoney(q.totalCents)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {openQuoteId && (
        <QuoteModal
          quoteId={openQuoteId}
          onClose={() => setOpenQuoteId(null)}
          onChanged={load}
          canManage={canManage}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  let cls = "bg-zinc-100 text-zinc-600";
  let label: string = status;
  if (status === "OPEN") {
    cls = "bg-amber-100 text-amber-800";
    label = "Open";
  } else if (status === "APPROVED") {
    cls = "bg-emerald-100 text-emerald-700";
    label = "Approved";
  } else if (status === "CONVERTED") {
    cls = "bg-indigo-100 text-indigo-700";
    label = "Converted";
  } else if (status === "REJECTED") {
    cls = "bg-red-100 text-red-700";
    label = "Rejected";
  }
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}
