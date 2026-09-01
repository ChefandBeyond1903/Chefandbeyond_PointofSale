"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
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
  umrpCents: number;
  trackStock: boolean;
  categoryId: string;
  active: boolean;
  favorite: boolean;
  vendor: string;
};

const emptyDraft: Draft = {
  name: "",
  sku: "",
  barcode: "",
  description: "",
  priceCents: 0,
  costCents: 0,
  umrpCents: 0,
  trackStock: true,
  categoryId: "",
  active: true,
  favorite: false,
  vendor: "",
};

export function ProductManager({ canManage = true }: { canManage?: boolean }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [vendorNames, setVendorNames] = useState<string[]>([]);

  // Per-store on-hand for the product open in the edit modal.
  const [editStock, setEditStock] = useState<
    { storeId: string; storeName: string; quantity: number }[] | null
  >(null);
  const [editStockLoading, setEditStockLoading] = useState(false);
  const [editableStoreIds, setEditableStoreIds] = useState<string[]>([]);
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({});
  const [savingStoreId, setSavingStoreId] = useState<string | null>(null);

  // Bulk selection / actions.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  // Inline "add vendor" state for the product modal.
  const [addingVendor, setAddingVendor] = useState(false);
  const [newVendor, setNewVendor] = useState({ name: "", email: "", phone: "" });
  const [savingVendor, setSavingVendor] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c, v] = await Promise.all([
        api<{ products: Product[] }>("/api/products?all=1&take=5000"),
        api<{ categories: Category[] }>("/api/categories"),
        api<{ vendors: { name: string }[] }>("/api/vendors"),
      ]);
      setProducts(p.products);
      setCategories(c.categories);
      setVendorNames(v.vendors.map((x) => x.name));
      // Drop any selected ids that no longer exist.
      setSelected((cur) => {
        const live = new Set(p.products.map((x) => x.id));
        return new Set([...cur].filter((id) => live.has(id)));
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadVendors = useCallback(async () => {
    const v = await api<{ vendors: { name: string }[] }>("/api/vendors");
    setVendorNames(v.vendors.map((x) => x.name));
  }, []);

  async function saveNewVendor() {
    const name = newVendor.name.trim();
    if (!name) return;
    setSavingVendor(true);
    setError(null);
    try {
      await api("/api/vendors", {
        method: "POST",
        body: JSON.stringify({ name, email: newVendor.email.trim(), phone: newVendor.phone.trim() }),
      });
      await reloadVendors();
      setDraft((d) => (d ? { ...d, vendor: name } : d));
      setAddingVendor(false);
      setNewVendor({ name: "", email: "", phone: "" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add vendor");
    } finally {
      setSavingVendor(false);
    }
  }

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
        (p.vendor ?? "").toLowerCase().includes(s) ||
        (p.barcode ?? "").toLowerCase().includes(s),
    );
  }, [products, q]);

  const filteredIds = useMemo(() => filtered.map((p) => p.id), [filtered]);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const someFilteredSelected = filteredIds.some((id) => selected.has(id));

  function toggleOne(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelected((cur) => {
      if (filteredIds.every((id) => cur.has(id))) {
        const next = new Set(cur);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...cur, ...filteredIds]);
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setBulkCategoryId("");
  }

  async function bulkMoveCategory() {
    if (selected.size === 0 || !bulkCategoryId) return;
    setBulkBusy(true);
    setError(null);
    try {
      await api("/api/products", {
        method: "PATCH",
        body: JSON.stringify({
          ids: [...selected],
          categoryId: bulkCategoryId === "__none__" ? null : bulkCategoryId,
        }),
      });
      clearSelection();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not move products");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkSetActive(active: boolean) {
    if (selected.size === 0) return;
    setBulkBusy(true);
    setError(null);
    try {
      await api("/api/products", {
        method: "PATCH",
        body: JSON.stringify({ ids: [...selected], active }),
      });
      clearSelection();
      load();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `Could not ${active ? "activate" : "deactivate"} products`,
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (
      !confirm(
        `Permanently delete ${selected.size} product(s)?\n\n` +
          `This can't be undone. Any product that appears on a past sale is ` +
          `archived instead so invoices stay intact.`,
      )
    )
      return;
    setBulkBusy(true);
    setError(null);
    try {
      const res = await api<{ deleted: number; archived: number }>("/api/products", {
        method: "DELETE",
        body: JSON.stringify({ ids: [...selected], hard: true }),
      });
      clearSelection();
      load();
      if (res.archived > 0) {
        setError(
          `${res.deleted} deleted. ${res.archived} kept as archived because they ` +
            `appear on past sales.`,
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete products");
    } finally {
      setBulkBusy(false);
    }
  }

  function resetVendorAdd() {
    setAddingVendor(false);
    setNewVendor({ name: "", email: "", phone: "" });
  }

  function closeDraft() {
    setDraft(null);
    setEditStock(null);
    setEditStockLoading(false);
    setEditableStoreIds([]);
    setStockDraft({});
    resetVendorAdd();
  }

  function startCreate() {
    setError(null);
    setEditStock(null);
    setEditableStoreIds([]);
    setStockDraft({});
    resetVendorAdd();
    setDraft({ ...emptyDraft });
  }

  function startEdit(p: Product) {
    setError(null);
    resetVendorAdd();
    setDraft({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode ?? "",
      description: p.description ?? "",
      priceCents: p.priceCents,
      costCents: p.costCents,
      umrpCents: p.umrpCents,
      trackStock: p.trackStock,
      categoryId: p.categoryId ?? "",
      active: p.active,
      favorite: p.favorite,
      vendor: p.vendor ?? "",
    });
    // Pull the per-store on-hand for this product in the background.
    setEditStock(null);
    setEditableStoreIds([]);
    setStockDraft({});
    setEditStockLoading(true);
    api<{
      storeStock: { storeId: string; storeName: string; quantity: number }[];
      editableStoreIds: string[];
    }>(`/api/products/${p.id}`)
      .then((res) => {
        setEditStock(res.storeStock);
        setEditableStoreIds(res.editableStoreIds ?? []);
        setStockDraft(
          Object.fromEntries(res.storeStock.map((s) => [s.storeId, String(s.quantity)])),
        );
      })
      .catch(() => setEditStock([]))
      .finally(() => setEditStockLoading(false));
  }

  async function saveStock(storeId: string) {
    if (!draft?.id) return;
    const raw = stockDraft[storeId] ?? "";
    const qty = Number(raw);
    if (raw.trim() === "" || !Number.isInteger(qty)) {
      setError("Enter a whole number for the store quantity.");
      return;
    }
    setSavingStoreId(storeId);
    setError(null);
    try {
      await api("/api/inventory", {
        method: "POST",
        body: JSON.stringify({ productId: draft.id, storeId, quantity: qty }),
      });
      setEditStock((cur) =>
        cur ? cur.map((s) => (s.storeId === storeId ? { ...s, quantity: qty } : s)) : cur,
      );
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update stock");
    } finally {
      setSavingStoreId(null);
    }
  }

  async function save() {
    if (!draft) return;
    if (draft.umrpCents > 0 && draft.priceCents < draft.umrpCents) {
      setError("Price can't be below the minimum resale price (UMRP).");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      name: draft.name,
      sku: draft.sku,
      barcode: draft.barcode || undefined,
      description: draft.description || undefined,
      priceCents: draft.priceCents,
      costCents: draft.costCents,
      umrpCents: draft.umrpCents,
      trackStock: draft.trackStock,
      categoryId: draft.categoryId || undefined,
      active: draft.active,
      favorite: draft.favorite,
      vendor: draft.vendor.trim(),
    };
    try {
      if (draft.id) {
        await api(`/api/products/${draft.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/products", { method: "POST", body: JSON.stringify(payload) });
      }
      closeDraft();
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
    <div className="w-full flex-1 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Products</h1>
        <input
          className="input max-w-xs"
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {canManage ? (
          <button onClick={startCreate} className="btn-primary ml-auto">
            + New product
          </button>
        ) : (
          <span className="ml-auto text-xs text-zinc-400">View only</span>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-500">Categories:</span>
        {categories.map((c) => (
          <span key={c.id} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs">
            {c.name} · {c._count?.products ?? 0}
          </span>
        ))}
        {canManage && (
          <>
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
          </>
        )}
      </div>

      {error && !draft && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {canManage && selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <button onClick={clearSelection} className="btn-ghost h-8 text-xs">
            Clear
          </button>
          <span className="mx-1 h-4 w-px bg-zinc-300" />
          <select
            className="input h-8 w-auto min-w-52"
            value={bulkCategoryId}
            onChange={(e) => setBulkCategoryId(e.target.value)}
            disabled={bulkBusy}
          >
            <option value="">Move to category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="__none__">— Remove category —</option>
          </select>
          <button
            onClick={bulkMoveCategory}
            disabled={bulkBusy || !bulkCategoryId}
            className="btn-secondary h-8"
          >
            Apply
          </button>
          <span className="mx-1 h-4 w-px bg-zinc-300" />
          <button
            onClick={() => bulkSetActive(true)}
            disabled={bulkBusy}
            className="btn-ghost h-8 text-xs"
          >
            Activate
          </button>
          <button
            onClick={() => bulkSetActive(false)}
            disabled={bulkBusy}
            className="btn-ghost h-8 text-xs"
            title="Set inactive — hides from the register, keeps the record"
          >
            Archive
          </button>
          <button
            onClick={bulkDelete}
            disabled={bulkBusy}
            className="btn-ghost ml-auto h-8 text-xs text-red-600"
          >
            Delete
          </button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              {canManage && (
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allFilteredSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected;
                    }}
                    onChange={toggleAllFiltered}
                  />
                </th>
              )}
              <th className="w-10 px-3 py-2.5" title="Show on register">★</th>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">SKU</th>
              <th className="px-4 py-2.5">Vendor</th>
              <th className="px-4 py-2.5">Category</th>
              <th className="px-4 py-2.5 text-right">Price</th>
              <th className="px-4 py-2.5 text-right" title="Minimum resale price">Min price</th>
              <th className="px-4 py-2.5 text-right" title="On-hand at your store (total for admins)">
                In stock
              </th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td
                  colSpan={canManage ? 10 : 9}
                  className="px-4 py-8 text-center text-zinc-400"
                >
                  Loading…
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                  {canManage && (
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${p.name}`}
                        checked={selected.has(p.id)}
                        onChange={() => toggleOne(p.id)}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => canManage && toggleFavorite(p)}
                      disabled={!canManage}
                      aria-label={p.favorite ? "Remove from register" : "Show on register"}
                      title={p.favorite ? "Showing on register" : "Show on register home"}
                      className={`text-lg leading-none transition-colors ${
                        p.favorite ? "text-amber-500" : "text-zinc-300"
                      } ${canManage ? "hover:text-zinc-400" : "cursor-default"}`}
                    >
                      {p.favorite ? "★" : "☆"}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 font-medium">
                    {canManage ? (
                      <button
                        onClick={() => startEdit(p)}
                        className="text-left hover:text-indigo-600 hover:underline"
                        title="Edit product"
                      >
                        {p.name}
                      </button>
                    ) : (
                      p.name
                    )}
                    {!p.active && <span className="ml-2 text-xs text-zinc-400">(archived)</span>}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {canManage ? (
                      <button
                        onClick={() => startEdit(p)}
                        className="hover:text-indigo-600 hover:underline"
                        title="Edit product"
                      >
                        {p.sku}
                      </button>
                    ) : (
                      p.sku
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">{p.vendor || "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{p.category?.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">{formatMoney(p.priceCents)}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-500">
                    {p.umrpCents > 0 ? formatMoney(p.umrpCents) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {p.trackStock ? (
                      <span className={p.stock <= 0 ? "text-red-500" : ""}>{p.stock}</span>
                    ) : (
                      <span className="text-zinc-300">∞</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {canManage ? (
                      <>
                        <button onClick={() => startEdit(p)} className="btn-ghost text-xs">
                          Edit
                        </button>
                        {p.active && (
                          <button
                            onClick={() => archive(p)}
                            className="btn-ghost text-xs text-red-500"
                          >
                            Archive
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-zinc-300">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={closeDraft}>
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
              <div className="col-span-2">
                <label className="label">Minimum price (UMRP)</label>
                <MoneyInput
                  cents={draft.umrpCents}
                  onCentsChange={(c) => setDraft({ ...draft, umrpCents: c })}
                />
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  The register blocks any sale below this after discounts. Leave 0 for no floor.
                </p>
                {draft.umrpCents > 0 && draft.priceCents < draft.umrpCents && (
                  <p className="mt-0.5 text-[11px] text-red-600">
                    Price is below the minimum — raise the price or lower the UMRP.
                  </p>
                )}
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
              <div className="col-span-2">
                <label className="label">Vendor</label>
                {!addingVendor ? (
                  <div className="flex gap-2">
                    <select
                      className="input"
                      value={draft.vendor}
                      onChange={(e) => {
                        if (e.target.value === "__add__") {
                          setNewVendor({ name: "", email: "", phone: "" });
                          setAddingVendor(true);
                        } else {
                          setDraft({ ...draft, vendor: e.target.value });
                        }
                      }}
                    >
                      <option value="">— None —</option>
                      {[...new Set([...vendorNames, draft.vendor].filter(Boolean))]
                        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
                        .map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      <option value="__add__">＋ Add new vendor…</option>
                    </select>
                  </div>
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
                      <button
                        type="button"
                        onClick={resetVendorAdd}
                        className="btn-ghost h-8 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      Saved to Vendors and selected for this product.
                    </p>
                  </div>
                )}
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
                  <span className="text-xs text-zinc-400">
                    Quantities are managed per store on the Inventory page and by receiving POs.
                  </span>
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

              {draft.id && (
                <div className="col-span-2">
                  <label className="label">Stock by store</label>
                  {editStockLoading ? (
                    <p className="text-xs text-zinc-400">Loading…</p>
                  ) : !draft.trackStock ? (
                    <p className="text-xs text-zinc-400">
                      Stock isn&rsquo;t tracked for this product.
                    </p>
                  ) : editStock && editStock.length > 0 ? (
                    <div className="overflow-hidden rounded-md border border-zinc-200">
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-zinc-100">
                          {editStock.map((s) => {
                            const canEditStore = editableStoreIds.includes(s.storeId);
                            const dirty =
                              canEditStore &&
                              (stockDraft[s.storeId] ?? String(s.quantity)) !==
                                String(s.quantity);
                            return (
                              <tr key={s.storeId}>
                                <td className="px-3 py-1.5 text-zinc-600">{s.storeName}</td>
                                <td className="px-3 py-1 text-right">
                                  {canEditStore ? (
                                    <span className="inline-flex items-center gap-1.5">
                                      <input
                                        type="number"
                                        step={1}
                                        className="input h-8 w-20 py-1 text-right tabular-nums"
                                        value={stockDraft[s.storeId] ?? String(s.quantity)}
                                        onChange={(e) =>
                                          setStockDraft((d) => ({
                                            ...d,
                                            [s.storeId]: e.target.value,
                                          }))
                                        }
                                      />
                                      <button
                                        type="button"
                                        onClick={() => saveStock(s.storeId)}
                                        disabled={!dirty || savingStoreId === s.storeId}
                                        className="btn-secondary h-8 px-2 text-xs"
                                      >
                                        {savingStoreId === s.storeId ? "…" : "Save"}
                                      </button>
                                    </span>
                                  ) : (
                                    <span
                                      className={`tabular-nums ${s.quantity <= 0 ? "text-red-500" : ""}`}
                                    >
                                      {s.quantity}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="bg-zinc-50 font-medium">
                            <td className="px-3 py-1.5">Total</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {editStock.reduce((a, b) => a + b.quantity, 0)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-400">No stores set up yet.</p>
                  )}
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {editableStoreIds.length > 0
                      ? "Set the on-hand count for your store here. Other stores are read-only; receiving a PO also updates stock."
                      : "Read-only — adjust counts on the Inventory page or by receiving a purchase order."}
                  </p>
                </div>
              )}
            </div>

            {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="mt-5 flex gap-2">
              <button onClick={closeDraft} className="btn-secondary flex-1">
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
