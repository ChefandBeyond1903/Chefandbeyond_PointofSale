"use client";

import { useEffect, useState } from "react";
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
 * search turns up nothing. Same fields as the full "New product" form under
 * Products & Vendors (barcode, cost, minimum price, vendor, category, active/
 * favorite…), so nothing has to be filled in later. Creates the product, then
 * hands it back so the caller can drop it straight into the current sale.
 */
export function QuickAddProductModal({
  initialName,
  categories,
  isAdmin,
  onClose,
  onCreated,
}: {
  initialName: string;
  categories: Category[];
  isAdmin: boolean;
  onClose: () => void;
  onCreated: (product: Product) => void;
}) {
  const [name, setName] = useState(initialName.trim());
  const [description, setDescription] = useState("");
  const [sku, setSku] = useState(suggestSku(initialName));
  const [barcode, setBarcode] = useState("");
  const [priceCents, setPriceCents] = useState(0);
  const [costCents, setCostCents] = useState(0);
  const [umrpCents, setUmrpCents] = useState(0);
  const [categoryId, setCategoryId] = useState("");
  const [vendor, setVendor] = useState("");
  const [trackStock, setTrackStock] = useState(true);
  const [active, setActive] = useState(true);
  const [favorite, setFavorite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [localCategories, setLocalCategories] = useState<Category[]>(categories);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);

  const [vendorNames, setVendorNames] = useState<string[]>([]);
  const [addingVendor, setAddingVendor] = useState(false);
  const [newVendor, setNewVendor] = useState({ name: "", email: "", phone: "" });
  const [savingVendor, setSavingVendor] = useState(false);

  useEffect(() => {
    api<{ vendors: { name: string }[] }>("/api/vendors")
      .then((r) => setVendorNames(r.vendors.map((v) => v.name)))
      .catch(() => {});
  }, []);

  async function saveNewCategory() {
    const catName = newCategoryName.trim();
    if (!catName) return;
    setSavingCategory(true);
    setErr(null);
    try {
      const { category } = await api<{ category: Category }>("/api/categories", {
        method: "POST",
        body: JSON.stringify({ name: catName }),
      });
      setLocalCategories((cur) => [...cur, category].sort((a, b) => a.name.localeCompare(b.name)));
      setCategoryId(category.id);
      setAddingCategory(false);
      setNewCategoryName("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add category");
    } finally {
      setSavingCategory(false);
    }
  }

  async function saveNewVendor() {
    const vName = newVendor.name.trim();
    if (!vName) return;
    setSavingVendor(true);
    setErr(null);
    try {
      await api("/api/vendors", {
        method: "POST",
        body: JSON.stringify({ name: vName, email: newVendor.email.trim(), phone: newVendor.phone.trim() }),
      });
      setVendorNames((cur) => [...new Set([...cur, vName])]);
      setVendor(vName);
      setAddingVendor(false);
      setNewVendor({ name: "", email: "", phone: "" });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add vendor");
    } finally {
      setSavingVendor(false);
    }
  }

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
          barcode: barcode.trim() || undefined,
          priceCents,
          costCents,
          umrpCents,
          trackStock,
          categoryId: categoryId || undefined,
          vendor: vendor.trim(),
          active,
          favorite,
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
        className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">New product</h2>
          <button onClick={onClose} className="btn-ghost px-2 py-1 text-sm">
            ✕
          </button>
        </div>

        {err && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="label">SKU</label>
            <input className="input" value={sku} onChange={(e) => setSku(e.target.value)} />
          </div>
          <div>
            <label className="label">Barcode</label>
            <input className="input" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </div>

          <div>
            <label className="label">Price</label>
            <MoneyInput cents={priceCents} onCentsChange={setPriceCents} className="input text-right" />
          </div>
          <div>
            <label className="label">Cost</label>
            <MoneyInput cents={costCents} onCentsChange={setCostCents} className="input text-right" />
          </div>

          <div className="col-span-2">
            <label className="label">Minimum price (UMRP)</label>
            <MoneyInput
              cents={umrpCents}
              onCentsChange={setUmrpCents}
              disabled={!isAdmin}
              className={`input ${isAdmin ? "" : "bg-zinc-50 text-zinc-400"}`}
            />
            <p className="mt-0.5 text-[11px] text-zinc-400">
              {isAdmin
                ? "The register blocks any sale below this after discounts. Leave 0 for no floor."
                : "Only an admin can change the minimum resale price."}
            </p>
          </div>

          <div className={addingCategory ? "col-span-2" : undefined}>
            <label className="label">Category</label>
            {!addingCategory ? (
              <select
                className="input"
                value={categoryId}
                onChange={(e) => {
                  if (e.target.value === "__add__") {
                    setNewCategoryName("");
                    setAddingCategory(true);
                  } else {
                    setCategoryId(e.target.value);
                  }
                }}
              >
                <option value="">— None —</option>
                {localCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="__add__">＋ Add new category…</option>
              </select>
            ) : (
              <div className="rounded-md border border-zinc-200 p-3">
                <p className="mb-2 text-xs font-medium text-zinc-600">New category</p>
                <input
                  className="input"
                  placeholder="Category name *"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveNewCategory();
                    }
                  }}
                  autoFocus
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={saveNewCategory}
                    disabled={savingCategory || !newCategoryName.trim()}
                    className="btn-primary h-8 text-xs"
                  >
                    {savingCategory ? "Adding…" : "Add category"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingCategory(false);
                      setNewCategoryName("");
                    }}
                    className="btn-ghost h-8 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="col-span-2">
            <label className="label">Vendor</label>
            {!addingVendor ? (
              <select
                className="input"
                value={vendor}
                onChange={(e) => {
                  if (e.target.value === "__add__") {
                    setNewVendor({ name: "", email: "", phone: "" });
                    setAddingVendor(true);
                  } else {
                    setVendor(e.target.value);
                  }
                }}
              >
                <option value="">— None —</option>
                {[...new Set([...vendorNames, vendor].filter(Boolean))]
                  .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
                  .map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                <option value="__add__">＋ Add new vendor…</option>
              </select>
            ) : (
              <div className="rounded-md border border-zinc-200 p-3">
                <p className="mb-2 text-xs font-medium text-zinc-600">New vendor</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    className="input"
                    placeholder="Name *"
                    value={newVendor.name}
                    onChange={(e) => setNewVendor({ ...newVendor, name: e.target.value })}
                    autoFocus
                  />
                  <input
                    className="input"
                    placeholder="Email"
                    value={newVendor.email}
                    onChange={(e) => setNewVendor({ ...newVendor, email: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Phone"
                    value={newVendor.phone}
                    onChange={(e) => setNewVendor({ ...newVendor, phone: e.target.value })}
                  />
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={saveNewVendor}
                    disabled={savingVendor || !newVendor.name.trim()}
                    className="btn-primary h-8 text-xs"
                  >
                    {savingVendor ? "Adding…" : "Add vendor"}
                  </button>
                  <button type="button" onClick={() => setAddingVendor(false)} className="btn-ghost h-8 text-xs">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="col-span-2 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={trackStock}
                onChange={(e) => setTrackStock(e.target.checked)}
              />
              Track stock
            </label>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Active
            </label>
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
            Show on register home <span className="text-zinc-400">(favorite)</span>
          </label>

          <div className="col-span-2">
            <label className="label">Description</label>
            <textarea
              className="input"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>
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
