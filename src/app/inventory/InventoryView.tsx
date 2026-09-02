"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import type { InventorySnapshot } from "@/lib/types";

export function InventoryView() {
  const [data, setData] = useState<InventorySnapshot | null>(null);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set("q", q.trim());
      if (showInactive) qs.set("all", "1");
      const res = await api<InventorySnapshot>(`/api/inventory?${qs.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }, [q, showInactive]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const canEditStore = useCallback(
    (storeId: string) =>
      !!data?.canAdjust && (data.editableStoreId === null || data.editableStoreId === storeId),
    [data],
  );

  async function adjust(productId: string, storeId: string, name: string, storeName: string, cur: number) {
    const raw = prompt(`On-hand for "${name}" at ${storeName}:`, String(cur));
    if (raw === null) return;
    const quantity = parseInt(raw.replace(/[^0-9-]/g, ""), 10);
    if (!Number.isFinite(quantity)) {
      setError("Enter a whole number");
      return;
    }
    setError(null);
    try {
      await api("/api/inventory", {
        method: "POST",
        body: JSON.stringify({ productId, storeId, quantity }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not adjust");
    }
  }

  const stores = useMemo(() => data?.stores ?? [], [data]);

  // In-stock first, then name. (Out-of-stock = tracked with total <= 0.)
  const rows = useMemo(() => {
    const rank = (r: { trackStock: boolean; total: number }) =>
      r.trackStock && r.total <= 0 ? 1 : 0;
    return [...(data?.rows ?? [])].sort(
      (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
    );
  }, [data]);

  return (
    <div className="w-full flex-1 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Inventory</h1>
        <input
          className="input max-w-xs"
          placeholder="Search name, SKU, vendor…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-sm text-zinc-500">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Include archived
        </label>
        {data?.canAdjust && (
          <span className="text-xs text-zinc-400">
            {data.editableStoreId === null
              ? "Click any quantity to set it."
              : "Click your store's quantity to set it."}
          </span>
        )}
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5">Product</th>
              <th className="px-4 py-2.5">SKU</th>
              <th className="px-4 py-2.5">Vendor</th>
              {stores.map((s) => (
                <th key={s.id} className="px-4 py-2.5 text-right">
                  {s.name.replace(/^Chef and Beyond - /, "")}
                  {!s.active ? " (inactive)" : ""}
                </th>
              ))}
              <th className="px-4 py-2.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={4 + stores.length} className="px-4 py-8 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4 + stores.length} className="px-4 py-8 text-center text-zinc-400">
                  No products.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.productId} className={r.active ? "" : "opacity-50"}>
                  <td className="px-4 py-2.5 font-medium">
                    {r.name}
                    {!r.trackStock && (
                      <span className="ml-2 text-xs text-zinc-400">(not tracked)</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">{r.sku}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{r.vendor || "—"}</td>
                  {stores.map((s) => {
                    const qty = r.byStore[s.id] ?? 0;
                    const editable = canEditStore(s.id);
                    return (
                      <td key={s.id} className="px-4 py-2.5 text-right">
                        {editable ? (
                          <button
                            onClick={() => adjust(r.productId, s.id, r.name, s.name, qty)}
                            className={`rounded px-1.5 py-0.5 tabular-nums hover:bg-zinc-100 ${
                              qty < 0 ? "text-red-500" : ""
                            }`}
                          >
                            {qty}
                          </button>
                        ) : (
                          <span className={`tabular-nums ${qty < 0 ? "text-red-500" : ""}`}>
                            {qty}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{r.total}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
