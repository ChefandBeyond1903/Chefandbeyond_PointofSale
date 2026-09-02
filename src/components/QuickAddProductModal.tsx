"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client";
import { MoneyInput } from "@/components/MoneyInput";
import type { Category, Product } from "@/lib/types";

/** Turn a product name into a reasonable starting SKU: "Gas Griddle 36" -> "GAS-GRIDDLE-36". */
function suggestSku(name: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return base || `NEW-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Add a product to the catalog without leaving the register — shown when a
 * search turns up nothing. Creates the product, then hands it back so the
 * caller can drop it straight into the current sale.
 */
export function QuickAddProductModal({
  initialName,
  categories,
  onClose,
  onCreated,
}: {
  initialName: string;
  categories: Category[];
  onClose: () => void;
  onCreated: (product: Product) => void;
}) {
  const [name, setName] = useState(initialName.trim());
  const [description, setDescription] = useState("");
  const [sku, setSku] = useState(suggestSku(initialName));
  const [priceCents, setPriceCents] = useState(0);
  const [categoryId, setCategoryId] = useState("");
  const [trackStock, setTrackStock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return setErr("Enter a product name.");
    if (!sku.trim()) return setErr("Enter a SKU.");
    if (priceCents <= 0) return setErr("Enter a price.");
    setBusy(true);
    setErr(null);
    try {
      const { product } = await api<{ product: Product }>("/api/products", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          sku: sku.trim(),
          priceCents,
          trackStock,
          categoryId: categoryId || undefined,
        }),
      });
      // The create endpoint doesn't return per-store stock; a fresh product has none.
      onCreated({ ...product, stock: product.stock ?? 0 });
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add the product");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">New product</h2>
          <button onClick={onClose} className="btn-ghost px-2 py-1 text-sm">
            ✕
          </button>
        </div>

        {err && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

        <div className="space-y-3">
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="label">Description</label>
            <textarea
              className="input"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Price</label>
              <MoneyInput
                cents={priceCents}
                onCentsChange={setPriceCents}
                className="input text-right"
              />
            </div>
            <div>
              <label className="label">SKU</label>
              <input className="input" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label">Category</label>
            <select
              className="input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={trackStock}
              onChange={(e) => setTrackStock(e.target.checked)}
            />
            Track stock for this product
          </label>
        </div>

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button onClick={submit} disabled={busy} className="btn-primary flex-1">
            {busy ? "Adding…" : "Add & put in sale"}
          </button>
        </div>
      </div>
    </div>
  );
}
