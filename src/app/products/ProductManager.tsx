"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney, formatBps } from "@/lib/money";
import { MoneyInput } from "@/components/MoneyInput";
import type { Category, Product } from "@/lib/types";

type Draft = {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  description: string;
  priceCents: number;
  costCents: number;
  taxRatePct: string;
  trackStock: boolean;
  stock: number;
  categoryId: string;
  active: boolean;
  favorite: boolean;
};

const emptyDraft: Draft = {
  name: "",
  sku: "",
  barcode: "",
  description: "",
  priceCents: 0,
  costCents: 0,
  taxRatePct: "0",
  trackStock: true,
  stock: 0,
  categoryId: "",
  active: true,
  favorite: false,
};

export function ProductManager() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        api<{ products: Product[] }>("/api/products?all=1&take=500"),
        api<{ categories: Category[] }>("/api/categories"),
      ]);
      setProducts(p.products);
      setCategories(c.categories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        p.sku.toLowerCase().includes(s) ||
        (p.barcode ?? "").toLowerCase().includes(s),
    );
  }, [products, q]);

  function startCreate() {
    setError(null);
    setDraft({ ...emptyDraft });
  }

  function startEdit(p: Product) {
    setError(null);
    setDraft({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode ?? "",
      description: p.description ?? "",
      priceCents: p.priceCents,
      costCents: p.costCents,
      taxRatePct: (p.taxRateBps / 100).toString(),
      trackStock: p.trackStock,
      stock: p.stock,
      categoryId: p.categoryId ?? "",
      active: p.active,
      favorite: p.favorite,
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: draft.name,
      sku: draft.sku,
      barcode: draft.barcode || undefined,
      description: draft.description || undefined,
      priceCents: draft.priceCents,
      costCents: draft.costCents,
      taxRateBps: Math.round(parseFloat(draft.taxRatePct || "0") * 100),
      trackStock: draft.trackStock,
      stock: draft.stock,
      categoryId: draft.categoryId || undefined,
      active: draft.active,
      favorite: draft.favorite,
    };
    try {
      if (draft.id) {
        await api(`/api/products/${draft.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/products", { method: "POST", body: JSON.stringify(payload) });
      }
      setDraft(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function toggleFavorite(p: Product) {
    const next = !p.favorite;
    setProducts((cur) => cur.map((x) => (x.id === p.id ? { ...x, favorite: next } : x)));
    try {
      await api(`/api/products/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ favorite: next }),
      });
    } catch (err) {
      setProducts((cur) => cur.map((x) => (x.id === p.id ? { ...x, favorite: !next } : x)));
      setError(err instanceof ApiError ? err.message : "Could not update favorite");
    }
  }

  async function archive(p: Product) {
    if (!confirm(`Archive "${p.name}"? It will no longer appear on the register.`)) return;
    try {
      await api(`/api/products/${p.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not archive");
    }
  }

  async function addCategory() {
    if (!newCategory.trim()) return;
    try {
      await api("/api/categories", { method: "POST", body: JSON.stringify({ name: newCategory.trim() }) });
      setNewCategory("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add category");
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Products</h1>
        <input
          className="input max-w-xs"
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button onClick={startCreate} className="btn-primary ml-auto">
          + New product
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-500">Categories:</span>
        {categories.map((c) => (
          <span key={c.id} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs">
            {c.name} · {c._count?.products ?? 0}
          </span>
        ))}
        <input
          className="input h-8 w-40"
          placeholder="New category"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addCategory()}
        />
        <button onClick={addCategory} className="btn-secondary h-8">
          Add
        </button>
      </div>

      {error && !draft && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="w-10 px-3 py-2.5" title="Show on register">★</th>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">SKU</th>
              <th className="px-4 py-2.5">Category</th>
              <th className="px-4 py-2.5 text-right">Price</th>
              <th className="px-4 py-2.5 text-right">Tax</th>
              <th className="px-4 py-2.5 text-right">Stock</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => toggleFavorite(p)}
                      aria-label={p.favorite ? "Remove from register" : "Show on register"}
                      title={p.favorite ? "Showing on register — click to remove" : "Show on register home"}
                      className={`text-lg leading-none transition-colors ${
                        p.favorite ? "text-amber-500" : "text-zinc-300 hover:text-zinc-400"
                      }`}
                    >
                      {p.favorite ? "★" : "☆"}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 font-medium">
                    {p.name}
                    {!p.active && <span className="ml-2 text-xs text-zinc-400">(archived)</span>}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">{p.sku}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{p.category?.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">{formatMoney(p.priceCents)}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-500">{formatBps(p.taxRateBps)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {p.trackStock ? (
                      <span className={p.stock <= 0 ? "text-red-500" : ""}>{p.stock}</span>
                    ) : (
                      <span className="text-zinc-300">∞</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(p)} className="btn-ghost text-xs">
                      Edit
                    </button>
                    {p.active && (
                      <button onClick={() => archive(p)} className="btn-ghost text-xs text-red-500">
                        Archive
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setDraft(null)}>
          <div
            className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold">
              {draft.id ? "Edit product" : "New product"}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Name</label>
                <input
                  className="input"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">SKU</label>
                <input
                  className="input"
                  value={draft.sku}
                  onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Barcode</label>
                <input
                  className="input"
                  value={draft.barcode}
                  onChange={(e) => setDraft({ ...draft, barcode: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Price</label>
                <MoneyInput
                  cents={draft.priceCents}
                  onCentsChange={(c) => setDraft({ ...draft, priceCents: c })}
                />
              </div>
              <div>
                <label className="label">Cost</label>
                <MoneyInput
                  cents={draft.costCents}
                  onCentsChange={(c) => setDraft({ ...draft, costCents: c })}
                />
              </div>
              <div>
                <label className="label">Tax rate %</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={draft.taxRatePct}
                  onChange={(e) => setDraft({ ...draft, taxRatePct: e.target.value.replace(/[^0-9.]/g, "") })}
                />
              </div>
              <div>
                <label className="label">Category</label>
                <select
                  className="input"
                  value={draft.categoryId}
                  onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                >
                  <option value="">— None —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.trackStock}
                    onChange={(e) => setDraft({ ...draft, trackStock: e.target.checked })}
                  />
                  Track stock
                </label>
                {draft.trackStock && (
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-zinc-500">Qty</label>
                    <input
                      className="input h-8 w-24"
                      value={draft.stock}
                      onChange={(e) =>
                        setDraft({ ...draft, stock: parseInt(e.target.value.replace(/[^0-9-]/g, ""), 10) || 0 })
                      }
                    />
                  </div>
                )}
                <label className="ml-auto flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                  />
                  Active
                </label>
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.favorite}
                  onChange={(e) => setDraft({ ...draft, favorite: e.target.checked })}
                />
                Show on register home <span className="text-zinc-400">(favorite)</span>
              </label>
              <div className="col-span-2">
                <label className="label">Description</label>
                <textarea
                  className="input"
                  rows={2}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
            </div>

            {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="mt-5 flex gap-2">
              <button onClick={() => setDraft(null)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button onClick={save} disabled={saving} className="btn-primary flex-1">
                {saving ? "Saving…" : "Save product"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
