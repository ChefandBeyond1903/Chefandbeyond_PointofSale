"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney, formatBps, taxOn } from "@/lib/money";
import { MoneyInput } from "@/components/MoneyInput";
import { PercentInput } from "@/components/PercentInput";
import type {
  Category,
  Company,
  Customer,
  Product,
  Role,
  Sale,
  Shift,
  ShiftStats,
} from "@/lib/types";

type DiscMode = "AMOUNT" | "PERCENT";

interface CartLine {
  product: Product;
  quantity: number;
  // Line discount in dollars (AMOUNT mode) — a total for the line, not per unit.
  discountCents: number;
  // Line discount as a percent of the line's list value (PERCENT mode).
  discPercent: number;
  discMode: DiscMode;
}

/** The line's list value before any discount. */
function lineBaseCents(l: CartLine): number {
  return l.product.priceCents * l.quantity;
}

/** Effective line discount in cents, from whichever mode is active, clamped. */
function resolveLineDiscount(l: CartLine): number {
  const base = lineBaseCents(l);
  const raw =
    l.discMode === "PERCENT" ? Math.round((base * l.discPercent) / 100) : l.discountCents;
  return Math.max(0, Math.min(base, raw));
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
  const [orderDiscPercent, setOrderDiscPercent] = useState(0);
  const [orderDiscMode, setOrderDiscMode] = useState<DiscMode>("AMOUNT");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [custId, setCustId] = useState<string | null>(null);
  const [custName, setCustName] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custAddress, setCustAddress] = useState("");
  const [custCompany, setCustCompany] = useState("");
  const [custOpen, setCustOpen] = useState(false);

  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftStats, setShiftStats] = useState<ShiftStats | null>(null);

  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [storeTaxRateBps, setStoreTaxRateBps] = useState<number | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        api<{ products: Product[] }>("/api/products?favorite=1&take=5000"),
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
      const r = await api<{ products: Product[] }>("/api/products?take=5000");
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

  const loadCustomers = useCallback(async () => {
    try {
      const res = await api<{ customers: Customer[] }>("/api/customers");
      setCustomers(res.customers);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    loadCatalog();
    loadShift();
    loadCustomers();
    api<{
      user: {
        role: Role;
        storeName?: string | null;
        storeTaxRateBps?: number | null;
      } | null;
    }>("/api/auth/me")
      .then((r) => {
        setRole(r.user?.role ?? null);
        setStoreName(r.user?.storeName ?? null);
        setStoreTaxRateBps(r.user?.storeTaxRateBps ?? null);
      })
      .catch(() => {});
    api<{ company: Company }>("/api/company")
      .then((r) => setCompany(r.company))
      .catch(() => {});
  }, [loadCatalog, loadShift, loadCustomers]);

  function pickCustomer(name: string) {
    setCustName(name);
    const match = customers.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (match) {
      setCustId(match.id);
      setCustEmail(match.email);
      setCustPhone(match.phone);
      setCustAddress(match.address);
      setCustCompany(match.company);
    } else {
      setCustId(null);
    }
  }

  function clearCustomer() {
    setCustId(null);
    setCustName("");
    setCustEmail("");
    setCustPhone("");
    setCustAddress("");
    setCustCompany("");
    setCustOpen(false);
  }

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
      const disc = resolveLineDiscount(line);
      subtotal += base;
      lineDiscounts += disc;
      perLineAfter.push(base - disc);
    }
    const sumAfterLine = perLineAfter.reduce((a, b) => a + b, 0);
    const orderDisc =
      orderDiscMode === "PERCENT"
        ? Math.min(sumAfterLine, Math.round((sumAfterLine * orderDiscPercent) / 100))
        : Math.min(orderDiscountCents, sumAfterLine);
    const rateBps = storeTaxRateBps ?? 0;

    let tax = 0;
    let allocated = 0;
    const umrpViolations: {
      productId: string;
      name: string;
      minEachCents: number;
      eachCents: number;
    }[] = [];
    cart.forEach((line, idx) => {
      const share =
        idx === cart.length - 1
          ? orderDisc - allocated
          : sumAfterLine > 0
            ? Math.round((orderDisc * perLineAfter[idx]) / sumAfterLine)
            : 0;
      allocated += idx === cart.length - 1 ? 0 : share;
      const net = perLineAfter[idx] - share;
      tax += taxOn(net, rateBps);

      const umrp = line.product.umrpCents ?? 0;
      if (umrp > 0 && line.quantity > 0 && net < umrp * line.quantity) {
        umrpViolations.push({
          productId: line.product.id,
          name: line.product.name,
          minEachCents: umrp,
          eachCents: Math.floor(net / line.quantity),
        });
      }
    });

    const discount = lineDiscounts + orderDisc;
    const total = subtotal - discount + tax;
    // "Customer total saving" = everything knocked off the list price.
    const savedCents = discount;
    const savedPct = subtotal > 0 ? (savedCents / subtotal) * 100 : 0;
    return {
      subtotal,
      discount,
      tax,
      total,
      umrpViolations,
      sumAfterLine,
      orderDiscountResolved: orderDisc,
      savedCents,
      savedPct,
    };
  }, [cart, orderDiscountCents, orderDiscPercent, orderDiscMode, storeTaxRateBps]);

  function addToCart(product: Product) {
    setError(null);
    setCart((cur) => {
      const idx = cur.findIndex((l) => l.product.id === product.id);
      if (idx >= 0) {
        const next = [...cur];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        ...cur,
        { product, quantity: 1, discountCents: 0, discPercent: 0, discMode: "AMOUNT" as const },
      ];
    });
  }

  function setQty(productId: string, quantity: number) {
    setCart((cur) =>
      quantity <= 0
        ? cur.filter((l) => l.product.id !== productId)
        : cur.map((l) => (l.product.id === productId ? { ...l, quantity } : l)),
    );
  }

  function updateLine(productId: string, patch: Partial<CartLine>) {
    setCart((cur) => cur.map((l) => (l.product.id === productId ? { ...l, ...patch } : l)));
  }

  // Switch a line between $ and % without losing the value: carry the current
  // resolved discount across into the other unit.
  function setLineDiscMode(productId: string, mode: DiscMode) {
    setCart((cur) =>
      cur.map((l) => {
        if (l.product.id !== productId || l.discMode === mode) return l;
        const base = lineBaseCents(l);
        const cents = resolveLineDiscount(l);
        return mode === "PERCENT"
          ? { ...l, discMode: mode, discPercent: base > 0 ? (cents / base) * 100 : 0 }
          : { ...l, discMode: mode, discountCents: cents };
      }),
    );
  }

  function setLineDiscAmount(productId: string, cents: number) {
    updateLine(productId, { discMode: "AMOUNT", discountCents: Math.max(0, cents) });
  }

  function setLineDiscPercent(productId: string, pct: number) {
    updateLine(productId, {
      discMode: "PERCENT",
      discPercent: Math.max(0, Math.min(100, pct)),
    });
  }

  // Edit the line's charged amount directly — stored as an equivalent $ discount.
  function setLineTotal(productId: string, totalCents: number) {
    setCart((cur) =>
      cur.map((l) => {
        if (l.product.id !== productId) return l;
        const base = lineBaseCents(l);
        const off = Math.max(0, Math.min(base, base - Math.max(0, totalCents)));
        return { ...l, discMode: "AMOUNT", discountCents: off };
      }),
    );
  }

  // Toggle the order discount unit, carrying the current value across.
  function changeOrderDiscMode(mode: DiscMode) {
    if (mode === orderDiscMode) return;
    const s = totals.sumAfterLine;
    const cents = totals.orderDiscountResolved;
    if (mode === "PERCENT") setOrderDiscPercent(s > 0 ? (cents / s) * 100 : 0);
    else setOrderDiscountCents(cents);
    setOrderDiscMode(mode);
  }

  function clearCart() {
    setCart([]);
    setOrderDiscountCents(0);
    setOrderDiscPercent(0);
    setOrderDiscMode("AMOUNT");
    clearCustomer();
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
            discountCents: resolveLineDiscount(l),
          })),
          orderDiscountCents: totals.orderDiscountResolved,
          paymentMethod,
          tenderedCents,
          ...(custId
            ? { customerId: custId }
            : custName.trim()
              ? {
                  customer: {
                    name: custName.trim(),
                    email: custEmail.trim(),
                    phone: custPhone.trim(),
                    address: custAddress.trim(),
                    company: custCompany.trim(),
                  },
                }
              : {}),
        }),
      });
      setReceipt(res.sale);
      setPayOpen(false);
      clearCart();
      loadCatalog();
      if (allProducts) loadAllProducts();
      loadShift();
      loadCustomers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not complete the sale");
    }
  }

  return (
    <div className="grid w-full flex-1 gap-4 p-4 lg:grid-cols-[1fr_460px]">
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
              const low = p.trackStock && p.stock <= 0;
              return (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="card flex flex-col items-start gap-1 p-3 text-left transition-transform hover:-translate-y-0.5 hover:shadow-md"
                >
                  <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-zinc-400">{p.sku}</span>
                  <span className="mt-auto text-sm font-semibold text-indigo-600">
                    {formatMoney(p.priceCents)}
                  </span>
                  {p.trackStock && (
                    <span className={`text-[11px] ${low ? "text-red-500" : "text-zinc-400"}`}>
                      {p.stock} in stock
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
            <div className="min-w-0">
              <h2 className="font-semibold">Current sale</h2>
              <p className="truncate text-xs text-zinc-400">
                {storeName ? (
                  <>
                    {storeName}
                    {storeTaxRateBps != null && ` · tax ${formatBps(storeTaxRateBps)}`}
                  </>
                ) : (
                  <span className="text-amber-600">
                    No store assigned — sales ring at 0% tax
                  </span>
                )}
              </p>
            </div>
            {cart.length > 0 && (
              <button onClick={clearCart} className="btn-ghost text-xs">
                Clear
              </button>
            )}
          </div>

          {/* Customer */}
          <div className="border-b border-zinc-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <input
                className="input h-8"
                list="customer-list"
                placeholder="Customer (optional)"
                value={custName}
                onChange={(e) => pickCustomer(e.target.value)}
              />
              <datalist id="customer-list">
                {customers.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
              {custName ? (
                <button onClick={clearCustomer} className="btn-ghost px-2 py-0.5 text-xs">
                  ✕
                </button>
              ) : null}
              <button
                onClick={() => setCustOpen((v) => !v)}
                className="btn-ghost whitespace-nowrap px-2 py-0.5 text-xs"
              >
                {custOpen ? "Hide" : "Details"}
              </button>
            </div>
            {custId && (
              <p className="mt-1 text-[11px] text-green-600">Existing customer — details on file</p>
            )}
            {custOpen && (
              <div className="mt-2 grid gap-2">
                <input
                  className="input h-8"
                  placeholder="Email"
                  value={custEmail}
                  onChange={(e) => setCustEmail(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="input h-8"
                    placeholder="Phone"
                    value={custPhone}
                    onChange={(e) => setCustPhone(e.target.value)}
                  />
                  <input
                    className="input h-8"
                    placeholder="Company"
                    value={custCompany}
                    onChange={(e) => setCustCompany(e.target.value)}
                  />
                </div>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Address"
                  value={custAddress}
                  onChange={(e) => setCustAddress(e.target.value)}
                />
                {!custId && custName.trim() && (
                  <p className="text-[11px] text-zinc-400">
                    New customer — added to Customers when the sale completes.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-400">
                Tap a product to start a sale.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {cart.map((line) => {
                  const violation = totals.umrpViolations.find(
                    (v) => v.productId === line.product.id,
                  );
                  const base = lineBaseCents(line);
                  const lineDisc = resolveLineDiscount(line);
                  const lineTotal = Math.max(0, base - lineDisc);
                  const unitNow = line.quantity > 0 ? Math.round(lineTotal / line.quantity) : 0;
                  const savedPct = base > 0 ? Math.round((lineDisc / base) * 100) : 0;
                  return (
                  <li key={line.product.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{line.product.name}</p>
                        <p className="text-xs text-zinc-400">
                          List {formatMoney(line.product.priceCents)} ea
                          {lineDisc > 0 && (
                            <>
                              {" · "}
                              <span className="text-green-600">
                                now {formatMoney(unitNow)} ea · save {formatMoney(lineDisc)} (
                                {savedPct}%)
                              </span>
                            </>
                          )}
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

                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        onClick={() => setQty(line.product.id, line.quantity - 1)}
                        className="btn-secondary h-7 w-7 shrink-0 !px-0"
                      >
                        −
                      </button>
                      <input
                        className="input h-7 w-9 shrink-0 px-1 text-center"
                        value={line.quantity}
                        onChange={(e) => {
                          const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
                          setQty(line.product.id, Number.isFinite(n) ? n : 0);
                        }}
                      />
                      <button
                        onClick={() => setQty(line.product.id, line.quantity + 1)}
                        className="btn-secondary h-7 w-7 shrink-0 !px-0"
                      >
                        +
                      </button>

                      <div className="ml-1 flex shrink-0 overflow-hidden rounded-md border border-zinc-300 text-xs">
                        <button
                          type="button"
                          onClick={() => setLineDiscMode(line.product.id, "AMOUNT")}
                          className={`px-1.5 py-1 ${line.discMode === "AMOUNT" ? "bg-indigo-600 text-white" : "text-zinc-500"}`}
                        >
                          $
                        </button>
                        <button
                          type="button"
                          onClick={() => setLineDiscMode(line.product.id, "PERCENT")}
                          className={`px-1.5 py-1 ${line.discMode === "PERCENT" ? "bg-indigo-600 text-white" : "text-zinc-500"}`}
                        >
                          %
                        </button>
                      </div>
                      {line.discMode === "PERCENT" ? (
                        <PercentInput
                          value={line.discPercent}
                          onValueChange={(n) => setLineDiscPercent(line.product.id, n)}
                          className="input h-7 w-14 shrink-0 px-2 text-right text-xs"
                          aria-label="Discount percent"
                        />
                      ) : (
                        <MoneyInput
                          cents={lineDisc}
                          onCentsChange={(c) => setLineDiscAmount(line.product.id, c)}
                          className="input h-7 w-20 shrink-0 px-2 text-right text-xs"
                        />
                      )}

                      <MoneyInput
                        cents={lineTotal}
                        onCentsChange={(c) => setLineTotal(line.product.id, c)}
                        className="input h-7 w-24 ml-auto shrink-0 px-2 text-right text-sm font-semibold"
                      />
                    </div>
                    {violation && (
                      <p className="mt-2 whitespace-pre-line rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">
                        {`Below minimum price — reduce the discount:\n\n${violation.name}: min ${formatMoney(
                          violation.minEachCents,
                        )} each (now ${formatMoney(violation.eachCents)})`}
                      </p>
                    )}
                  </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="space-y-2 border-t border-zinc-100 px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">
                Order discount
                {totals.orderDiscountResolved > 0 && (
                  <span className="ml-1 text-xs text-green-600">
                    − {formatMoney(totals.orderDiscountResolved)}
                    {totals.sumAfterLine > 0 &&
                      ` (${Math.round((totals.orderDiscountResolved / totals.sumAfterLine) * 100)}%)`}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1">
                <div className="flex overflow-hidden rounded-md border border-zinc-300 text-xs">
                  <button
                    type="button"
                    onClick={() => changeOrderDiscMode("AMOUNT")}
                    className={`px-2 py-1 ${orderDiscMode === "AMOUNT" ? "bg-indigo-600 text-white" : "text-zinc-500"}`}
                  >
                    $
                  </button>
                  <button
                    type="button"
                    onClick={() => changeOrderDiscMode("PERCENT")}
                    className={`px-2 py-1 ${orderDiscMode === "PERCENT" ? "bg-indigo-600 text-white" : "text-zinc-500"}`}
                  >
                    %
                  </button>
                </div>
                {orderDiscMode === "PERCENT" ? (
                  <PercentInput
                    value={orderDiscPercent}
                    onValueChange={setOrderDiscPercent}
                    className="input h-8 w-24 px-2 text-right"
                    aria-label="Order discount percent"
                  />
                ) : (
                  <MoneyInput
                    cents={orderDiscountCents}
                    onCentsChange={setOrderDiscountCents}
                    className="input h-8 w-24 px-2 text-right"
                  />
                )}
              </div>
            </div>
            <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
            <Row label="Discount" value={`− ${formatMoney(totals.discount)}`} />
            <Row
              label={`Tax${storeTaxRateBps != null ? ` (${formatBps(storeTaxRateBps)})` : ""}`}
              value={formatMoney(totals.tax)}
            />
            <div className="flex items-center justify-between border-t border-zinc-100 pt-2 text-base font-bold">
              <span>Total</span>
              <span>{formatMoney(totals.total)}</span>
            </div>
            {totals.savedCents > 0 && (
              <div className="flex items-center justify-between rounded bg-green-50 px-2 py-1.5 font-medium text-green-700">
                <span>You saved</span>
                <span>
                  {formatMoney(totals.savedCents)} ({Math.round(totals.savedPct)}% off)
                </span>
              </div>
            )}

            {error && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

            {totals.umrpViolations.length > 0 && (
              <p className="text-xs text-red-700">
                One or more items are below their minimum price — see the flagged lines above.
              </p>
            )}

            <button
              onClick={() => setPayOpen(true)}
              disabled={cart.length === 0 || totals.umrpViolations.length > 0}
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

      {receipt && (
        <ReceiptModal sale={receipt} company={company} onClose={() => setReceipt(null)} />
      )}
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

function ReceiptModal({
  sale,
  company,
  onClose,
}: {
  sale: Sale;
  company: Company | null;
  onClose: () => void;
}) {
  const header = company?.name?.trim() || "CB POS";
  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-sm">
        <div id="receipt" className="rounded-md border border-zinc-200 p-4 font-mono text-xs">
          <p className="text-center text-sm font-bold">{header}</p>
          {sale.storeNameSnapshot ? (
            <p className="text-center text-zinc-500">{sale.storeNameSnapshot}</p>
          ) : null}
          {company?.address ? (
            <p className="text-center text-zinc-500">{company.address}</p>
          ) : null}
          {company?.phone ? (
            <p className="text-center text-zinc-500">{company.phone}</p>
          ) : null}
          <p className="text-center text-zinc-500">Sale #{sale.number}</p>
          <p className="text-center text-zinc-500">{new Date(sale.createdAt).toLocaleString()}</p>
          {sale.customerNameSnapshot ? (
            <p className="text-center text-zinc-500">Customer: {sale.customerNameSnapshot}</p>
          ) : null}
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
            <span>Tax{sale.taxRateBps ? ` (${formatBps(sale.taxRateBps)})` : ""}</span>
            <span>{formatMoney(sale.taxCents)}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>Total</span>
            <span>{formatMoney(sale.totalCents)}</span>
          </div>
          {sale.discountCents > 0 && (
            <div className="flex justify-between font-bold">
              <span>You saved</span>
              <span>
                {formatMoney(sale.discountCents)}
                {sale.subtotalCents > 0
                  ? ` (${Math.round((sale.discountCents / sale.subtotalCents) * 100)}% off)`
                  : ""}
              </span>
            </div>
          )}
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
