"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney, taxOn } from "@/lib/money";
import { MoneyInput } from "@/components/MoneyInput";
import type { Category, Product, Role, Sale, Shift, ShiftStats } from "@/lib/types";

interface CartLine {
  product: Product;
  quantity: number;
  discountCents: number;
}

export default function RegisterPage() {
  const [favorites, setFavorites] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[] | null>(null);
  const [searchHits, setSearchHits] = useState<Product[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [browseAll, setBrowseAll] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderDiscountCents, setOrderDiscountCents] = useState(0);

  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftStats, setShiftStats] = useState<ShiftStats | null>(null);

  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        api<{ products: Product[] }>("/api/products?favorite=1&take=1000"),
        api<{ categories: Category[] }>("/api/categories"),
      ]);
      setFavorites(p.products);
      setCategories(c.categories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAllProducts = useCallback(async () => {
    try {
      const r = await api<{ products: Product[] }>("/api/products?take=1000");
      setAllProducts(r.products);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load products");
    }
  }, []);

  function toggleBrowseAll() {
    setBrowseAll((on) => {
      const next = !on;
      if (next && !allProducts) loadAllProducts();
      return next;
    });
  }

  const loadShift = useCallback(async () => {
    try {
      const res = await api<{ shift: Shift | null; stats?: ShiftStats }>("/api/shifts/current");
      setShift(res.shift);
      setShiftStats(res.stats ?? null);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    loadCatalog();
    loadShift();
    api<{ user: { role: Role } | null }>("/api/auth/me")
      .then((r) => setRole(r.user?.role ?? null))
      .catch(() => {});
  }, [loadCatalog, loadShift]);

  const isManager = role === "MANAGER";

  async function toggleFavorite(p: Product, next: boolean) {
    // Optimistic update across whichever lists hold this product.
    const apply = (list: Product[]) =>
      list.map((x) => (x.id === p.id ? { ...x, favorite: next } : x));
    setFavorites((cur) => (next ? [...apply(cur), { ...p, favorite: true }].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i) : cur.filter((x) => x.id !== p.id)));
    setAllProducts((cur) => (cur ? apply(cur) : cur));
    setSearchHits((cur) => (cur ? apply(cur) : cur));
    try {
      await api(`/api/products/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ favorite: next }),
      });
      loadCatalog();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update favorite");
      loadCatalog();
    }
  }

  // Search runs against the whole catalog on the server (debounced).
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchHits(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api<{ products: Product[] }>(
          `/api/products?q=${encodeURIComponent(q)}&take=80`,
        );
        setSearchHits(r.products);
      } catch {
        setSearchHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const isSearching = query.trim().length > 0;

  const filtered = useMemo(() => {
    const source = isSearching
      ? (searchHits ?? [])
      : browseAll
        ? (allProducts ?? [])
        : favorites;
    return source.filter((p) => !activeCategory || p.categoryId === activeCategory);
  }, [isSearching, searchHits, browseAll, allProducts, favorites, activeCategory]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let lineDiscounts = 0;
    const perLineAfter: number[] = [];
    for (const line of cart) {
      const base = line.product.priceCents * line.quantity;
      const disc = Math.min(line.discountCents, base);
      subtotal += base;
      lineDiscounts += disc;
      perLineAfter.push(base - disc);
    }
    const sumAfterLine = perLineAfter.reduce((a, b) => a + b, 0);
    const orderDisc = Math.min(orderDiscountCents, sumAfterLine);

    let tax = 0;
    let allocated = 0;
    cart.forEach((line, idx) => {
      const share =
        idx === cart.length - 1
          ? orderDisc - allocated
          : sumAfterLine > 0
            ? Math.round((orderDisc * perLineAfter[idx]) / sumAfterLine)
            : 0;
      allocated += idx === cart.length - 1 ? 0 : share;
      const net = perLineAfter[idx] - share;
      tax += taxOn(net, line.product.taxRateBps);
    });

    const discount = lineDiscounts + orderDisc;
    return { subtotal, discount, tax, total: subtotal - discount + tax };
  }, [cart, orderDiscountCents]);

  function addToCart(product: Product) {
    setError(null);
    setCart((cur) => {
      const idx = cur.findIndex((l) => l.product.id === product.id);
      if (idx >= 0) {
        const next = [...cur];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...cur, { product, quantity: 1, discountCents: 0 }];
    });
  }

  function setQty(productId: string, quantity: number) {
    setCart((cur) =>
      quantity <= 0
        ? cur.filter((l) => l.product.id !== productId)
        : cur.map((l) => (l.product.id === productId ? { ...l, quantity } : l)),
    );
  }

  function setLineDiscount(productId: string, cents: number) {
    setCart((cur) => cur.map((l) => (l.product.id === productId ? { ...l, discountCents: cents } : l)));
  }

  function clearCart() {
    setCart([]);
    setOrderDiscountCents(0);
  }

  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    if (filtered.length === 1) {
      addToCart(filtered[0]);
      setQuery("");
    } else {
      const exact = filtered.find(
        (p) => p.barcode === query.trim() || p.sku.toLowerCase() === query.trim().toLowerCase(),
      );
      if (exact) {
        addToCart(exact);
        setQuery("");
      }
    }
  }

  async function completeSale(paymentMethod: "CASH" | "CARD", tenderedCents: number) {
    setError(null);
    try {
      const res = await api<{ sale: Sale }>("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          items: cart.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            discountCents: l.discountCents,
          })),
          orderDiscountCents,
          paymentMethod,
          tenderedCents,
        }),
      });
      setReceipt(res.sale);
      setPayOpen(false);
      clearCart();
      loadCatalog();
      if (allProducts) loadAllProducts();
      loadShift();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not complete the sale");
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl flex-1 gap-4 p-4 lg:grid-cols-[1fr_400px]">
      {/* Catalog */}
      <section className="flex min-h-0 flex-col">
        <div className="mb-3 flex gap-2">
          <input
            ref={searchRef}
            className="input"
            placeholder="Search name, SKU, or scan barcode…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            autoFocus
          />
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveCategory(null)}
            className={activeCategory === null ? "btn-primary" : "btn-secondary"}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={activeCategory === c.id ? "btn-primary" : "btn-secondary"}
            >
              {c.name}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-zinc-500">Loading catalog…</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 overflow-y-auto pb-4 sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((p) => {
              const out = p.trackStock && p.stock <= 0;
              return (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  disabled={out}
                  className="card flex flex-col items-start gap-1 p-3 text-left transition-transform hover:-translate-y-0.5 hover:shadow-md disabled:opacity-40 disabled:hover:translate-y-0"
                >
                  <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-zinc-400">{p.sku}</span>
                  <span className="mt-auto text-sm font-semibold text-indigo-600">
                    {formatMoney(p.priceCents)}
                  </span>
                  {p.trackStock && (
                    <span className={`text-[11px] ${out ? "text-red-500" : "text-zinc-400"}`}>
                      {out ? "Out of stock" : `${p.stock} in stock`}
                    </span>
                  )}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="col-span-full text-sm text-zinc-500">No matching products.</p>
            )}
          </div>
        )}
      </section>

      {/* Ticket */}
      <section className="flex min-h-0 flex-col gap-3">
        <ShiftWidget shift={shift} stats={shiftStats} onChanged={loadShift} />

        <div className="card flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <h2 className="font-semibold">Current sale</h2>
            {cart.length > 0 && (
              <button onClick={clearCart} className="btn-ghost text-xs">
                Clear
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-400">
                Tap a product to start a sale.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {cart.map((line) => (
                  <li key={line.product.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{line.product.name}</p>
                        <p className="text-xs text-zinc-400">
                          {formatMoney(line.product.priceCents)} each
                        </p>
                      </div>
                      <button
                        onClick={() => setQty(line.product.id, 0)}
                        className="btn-ghost px-1.5 py-0.5 text-xs text-red-500"
                        aria-label="Remove"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setQty(line.product.id, line.quantity - 1)}
                          className="btn-secondary h-7 w-7 !px-0"
                        >
                          −
                        </button>
                        <input
                          className="input h-7 w-12 px-1 text-center"
                          value={line.quantity}
                          onChange={(e) => {
                            const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
                            setQty(line.product.id, Number.isFinite(n) ? n : 0);
                          }}
                        />
                        <button
                          onClick={() => setQty(line.product.id, line.quantity + 1)}
                          className="btn-secondary h-7 w-7 !px-0"
                        >
                          +
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-zinc-400">disc</span>
                        <MoneyInput
                          cents={line.discountCents}
                          onCentsChange={(c) => setLineDiscount(line.product.id, c)}
                          className="input h-7 w-20 px-2 text-right text-xs"
                        />
                      </div>
                      <span className="w-20 text-right text-sm font-semibold">
                        {formatMoney(
                          Math.max(
                            0,
                            line.product.priceCents * line.quantity - line.discountCents,
                          ),
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2 border-t border-zinc-100 px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Order discount</span>
              <MoneyInput
                cents={orderDiscountCents}
                onCentsChange={setOrderDiscountCents}
                className="input h-8 w-28 px-2 text-right"
              />
            </div>
            <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
            <Row label="Discount" value={`− ${formatMoney(totals.discount)}`} />
            <Row label="Tax" value={formatMoney(totals.tax)} />
            <div className="flex items-center justify-between border-t border-zinc-100 pt-2 text-base font-bold">
              <span>Total</span>
              <span>{formatMoney(totals.total)}</span>
            </div>

            {error && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

            <button
              onClick={() => setPayOpen(true)}
              disabled={cart.length === 0}
              className="btn-primary mt-1 w-full py-3 text-base"
            >
              Charge {formatMoney(totals.total)}
            </button>
          </div>
        </div>
      </section>

      {payOpen && (
        <PaymentModal
          total={totals.total}
          onClose={() => setPayOpen(false)}
          onConfirm={completeSale}
          error={error}
        />
      )}

      {receipt && <ReceiptModal sale={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ShiftWidget({
  shift,
  stats,
  onChanged,
}: {
  shift: Shift | null;
  stats: ShiftStats | null;
  onChanged: () => void;
}) {
  const [floatCents, setFloatCents] = useState(0);
  const [countCents, setCountCents] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/shifts", {
        method: "POST",
        body: JSON.stringify({ openingFloatCents: floatCents }),
      });
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!shift) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/shifts/${shift.id}`, {
        method: "PATCH",
        body: JSON.stringify({ closingCountCents: countCents }),
      });
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!shift) {
    return (
      <div className="card p-3 text-sm">
        <p className="mb-2 font-medium">Till closed</p>
        <div className="flex items-center gap-2">
          <MoneyInput
            cents={floatCents}
            onCentsChange={setFloatCents}
            className="input h-8"
            placeholder="Opening float"
          />
          <button onClick={open} disabled={busy} className="btn-primary h-8 whitespace-nowrap">
            Open till
          </button>
        </div>
        {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      </div>
    );
  }

  return (
    <div className="card p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium text-green-700">Till open</p>
        <span className="text-xs text-zinc-400">
          since {new Date(shift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      {stats && (
        <dl className="grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <dt className="text-zinc-400">Sales</dt>
            <dd className="font-semibold">{stats.saleCount}</dd>
          </div>
          <div>
            <dt className="text-zinc-400">Taken</dt>
            <dd className="font-semibold">{formatMoney(stats.totalCents)}</dd>
          </div>
          <div>
            <dt className="text-zinc-400">Drawer</dt>
            <dd className="font-semibold">{formatMoney(stats.expectedDrawerCents)}</dd>
          </div>
        </dl>
      )}
      <div className="mt-2 flex items-center gap-2">
        <MoneyInput
          cents={countCents}
          onCentsChange={setCountCents}
          className="input h-8"
          placeholder="Counted cash"
        />
        <button onClick={close} disabled={busy} className="btn-secondary h-8 whitespace-nowrap">
          Close till
        </button>
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}

function PaymentModal({
  total,
  onClose,
  onConfirm,
  error,
}: {
  total: number;
  onClose: () => void;
  onConfirm: (method: "CASH" | "CARD", tenderedCents: number) => Promise<void>;
  error: string | null;
}) {
  const [tab, setTab] = useState<"CASH" | "CARD">("CASH");
  const [tendered, setTendered] = useState(total);
  const [busy, setBusy] = useState(false);

  const quick = [total, 500, 1000, 2000, 5000, 10000];
  const change = Math.max(0, tendered - total);

  async function go() {
    setBusy(true);
    try {
      await onConfirm(tab, tab === "CASH" ? tendered : total);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-md">
        <h3 className="mb-1 text-lg font-semibold">Take payment</h3>
        <p className="mb-4 text-sm text-zinc-500">
          Amount due <span className="font-semibold text-zinc-900">{formatMoney(total)}</span>
        </p>

        <div className="mb-4 flex gap-1 rounded-md bg-zinc-100 p-1">
          {(["CASH", "CARD"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setTab(m)}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${
                tab === m ? "bg-white shadow-sm" : "text-zinc-500"
              }`}
            >
              {m === "CASH" ? "Cash" : "Card"}
            </button>
          ))}
        </div>

        {tab === "CASH" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {quick.map((c, i) => (
                <button
                  key={i}
                  onClick={() => setTendered(c)}
                  className="btn-secondary"
                >
                  {i === 0 ? "Exact" : formatMoney(c)}
                </button>
              ))}
            </div>
            <div>
              <label className="label">Cash received</label>
              <MoneyInput cents={tendered} onCentsChange={setTendered} autoFocus />
            </div>
            <div className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-sm">
              <span className="text-zinc-500">Change due</span>
              <span className="text-lg font-bold">{formatMoney(change)}</span>
            </div>
          </div>
        ) : (
          <p className="rounded-md bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">
            Run the card on your terminal, then confirm below.
          </p>
        )}

        {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            onClick={go}
            disabled={busy || (tab === "CASH" && tendered < total)}
            className="btn-primary flex-1"
          >
            {busy ? "Processing…" : "Complete sale"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function ReceiptModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-sm">
        <div id="receipt" className="rounded-md border border-zinc-200 p-4 font-mono text-xs">
          <p className="text-center text-sm font-bold">CB POS</p>
          <p className="text-center text-zinc-500">Sale #{sale.number}</p>
          <p className="text-center text-zinc-500">{new Date(sale.createdAt).toLocaleString()}</p>
          <hr className="my-2 border-dashed" />
          {sale.items.map((it) => (
            <div key={it.id} className="flex justify-between">
              <span>
                {it.quantity}× {it.nameSnapshot}
              </span>
              <span>{formatMoney(it.lineTotalCents)}</span>
            </div>
          ))}
          <hr className="my-2 border-dashed" />
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatMoney(sale.subtotalCents)}</span>
          </div>
          <div className="flex justify-between">
            <span>Discount</span>
            <span>− {formatMoney(sale.discountCents)}</span>
          </div>
          <div className="flex justify-between">
            <span>Tax</span>
            <span>{formatMoney(sale.taxCents)}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>Total</span>
            <span>{formatMoney(sale.totalCents)}</span>
          </div>
          <div className="flex justify-between">
            <span>{sale.paymentMethod}</span>
            <span>{formatMoney(sale.tenderedCents)}</span>
          </div>
          {sale.changeCents > 0 && (
            <div className="flex justify-between">
              <span>Change</span>
              <span>{formatMoney(sale.changeCents)}</span>
            </div>
          )}
          <p className="mt-3 text-center text-zinc-500">Thank you!</p>
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={() => window.print()} className="btn-secondary flex-1">
            Print
          </button>
          <button onClick={onClose} className="btn-primary flex-1">
            New sale
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div className="card w-auto p-6" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
