"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { usePaged } from "@/lib/usePaged";
import { Pager } from "@/components/Pager";
import { ListHeader } from "@/components/ListToolbar";
import { LoadingRow, EmptyRow } from "@/components/TableState";
import type { SessionUser, Transfer } from "@/lib/types";

const STATUSES = ["ALL", "PENDING", "SHIPPED"] as const;
type StatusFilter = (typeof STATUSES)[number];

export function TransfersView() {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [rows, setRows] = useState<Transfer[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = filter === "ALL" ? "" : `?status=${filter}`;
      const [t, meRes] = await Promise.all([
        api<{ transfers: Transfer[] }>(`/api/transfers${qs}`),
        api<{ user: SessionUser | null }>("/api/auth/me"),
      ]);
      setRows(t.transfers);
      setMe(meRes.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load transfers");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const pg = usePaged(rows);

  async function markShipped(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api(`/api/transfers/${id}`, { method: "PATCH" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark this shipped");
    } finally {
      setBusyId(null);
    }
  }

  const canShip = (t: Transfer) => me?.role === "ADMIN" || me?.storeId === t.fromStoreId;
  const pendingCount = rows.filter((t) => t.status === "PENDING").length;

  return (
    <div className="w-full flex-1 p-4">
      <ListHeader title="Transfers">
        <div className="ml-auto flex gap-1 rounded-md bg-zinc-100 p-1 text-sm">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded px-2.5 py-1 font-medium ${
                filter === s ? "bg-white shadow-sm" : "text-zinc-500"
              }`}
            >
              {s === "ALL" ? "All" : s[0] + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </ListHeader>

      <p className="mb-3 text-xs text-zinc-400">
        A sale rung at one store that drew stock from another. The fulfilling store marks it
        shipped once the item actually goes out.
      </p>

      {filter !== "PENDING" && pendingCount > 0 && (
        <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {pendingCount} transfer{pendingCount === 1 ? "" : "s"} still need{pendingCount === 1 ? "s" : ""}{" "}
          to ship.
        </p>
      )}
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <Pager {...pg} className="mb-2 justify-end" />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5">Product</th>
              <th className="px-4 py-2.5 text-right">Qty</th>
              <th className="px-4 py-2.5">From</th>
              <th className="px-4 py-2.5">To</th>
              <th className="px-4 py-2.5">Sale</th>
              <th className="px-4 py-2.5">Created</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <LoadingRow colSpan={8} />
            ) : pg.total === 0 ? (
              <EmptyRow colSpan={8}>
                {filter === "ALL" ? "No transfers yet." : `No ${filter.toLowerCase()} transfers.`}
              </EmptyRow>
            ) : (
              pg.pageItems.map((t) => (
                <tr key={t.id} className={t.status === "PENDING" ? "bg-amber-50/40" : ""}>
                  <td className="px-4 py-2.5 font-medium">{t.productName || "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{t.quantity}</td>
                  <td className="px-4 py-2.5">{t.fromStoreName || "—"}</td>
                  <td className="px-4 py-2.5">{t.toStoreName || "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {t.saleNumber ? `#${t.saleNumber}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {new Date(t.createdAt).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                      year: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        t.status === "PENDING"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-green-100 text-green-700"
                      }`}
                    >
                      {t.status === "PENDING" ? "Needs shipping" : "Shipped"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {t.status === "PENDING" && canShip(t) && (
                      <button
                        onClick={() => markShipped(t.id)}
                        disabled={busyId === t.id}
                        className="btn-secondary h-7 text-xs"
                      >
                        {busyId === t.id ? "Saving…" : "Mark shipped"}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
