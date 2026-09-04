"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { formatMoney, formatBps, taxOn } from "@/lib/money";
import { MoneyInput } from "@/components/MoneyInput";
import { PercentInput } from "@/components/PercentInput";
import { ReceiptModal } from "@/components/ReceiptModal";
import { QuickAddProductModal } from "@/components/QuickAddProductModal";
import { dueDateFromTerms } from "@/lib/terms";
import { phoneDigits, formatPhone } from "@/lib/phone";
import { PhoneInput } from "@/components/PhoneInput";
import type {
  Category,
  Company,
  Customer,
  HeldSaleDetail,
  HeldSaleSummary,
  Product,
  Quote,
  Role,
  Sale,
  Shift,
  ShiftStats,
  Store,
} from "@/lib/types";

type DiscMode = "AMOUNT" | "PERCENT";

// Persist the in-progress ticket so a page refresh (or an auto-reload on a new
// deploy) doesn't wipe what the salesperson has rung up. Cleared as soon as the
// cart is emptied — completed, held, or cleared by hand.
const TICKET_KEY = "cb-pos-register-ticket-v1";

interface TicketSnapshot {
  cart: CartLine[];
  shippingCents: number;
  custId: string | null;
  custName: string;
  custEmail: string;
  custPhone: string;
  custAddress: string;
  custCompany: string;
  salespersonId: string;
}

interface CartLine {
  product: Product;
  quantity: number;
  // Per-unit price actually charged. Starts at the catalog price and can be
  // edited up or down at the register.
  unitPriceCents: number;
  // Line discount in dollars (AMOUNT mode) — a total for the line, not per unit.
  discountCents: number;
  // Line discount as a percent of the priced line value (PERCENT mode).
  discPercent: number;
  discMode: DiscMode;
  // Optional serial number(s) for a serialised item.
  serialNumber?: string;
}

/** Catalog list value of the line (before any manual price change). */
function lineListCents(l: CartLine): number {
  return l.product.priceCents * l.quantity;
}

/** The line value the discount applies to: charged unit price × qty. */
function linePricedCents(l: CartLine): number {
  return l.unitPriceCents * l.quantity;
}

/** Effective line discount in cents, from whichever mode is active, clamped. */
function resolveLineDiscount(l: CartLine): number {
  const base = linePricedCents(l);
  const raw =
    l.discMode === "PERCENT" ? Math.round((base * l.discPercent) / 100) : l.discountCents;
  return Math.max(0, Math.min(base, raw));
}

/** What the customer pays for this line, before order-level discount. */
function lineNetCents(l: CartLine): number {
  return Math.max(0, linePricedCents(l) - resolveLineDiscount(l));
}

export default function RegisterPage() {
  const router = useRouter();
  const [favorites, setFavorites] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[] | null>(null);
  const [searchHits, setSearchHits] = useState<Product[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [browseAll, setBrowseAll] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // The catalog (category filters + product grid) is hidden by default so the
  // register opens straight to the search box and the current sale. A search
  // always reveals its results regardless.
  const [catalogOpen, setCatalogOpen] = useState(false);
  // Brief "Added ✓" flash on the last-tapped catalog card.
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [shippingCents, setShippingCents] = useState(0);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [custId, setCustId] = useState<string | null>(null);
  const [custName, setCustName] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custAddress, setCustAddress] = useState("");
  const [custCompany, setCustCompany] = useState("");
  const [custOpen, setCustOpen] = useState(false);
  const [custMenuOpen, setCustMenuOpen] = useState(false);

  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftStats, setShiftStats] = useState<ShiftStats | null>(null);

  const [payOpen, setPayOpen] = useState(false);
  const [held, setHeld] = useState<HeldSaleSummary[]>([]);
  const [heldOpen, setHeldOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  const [savingQuote, setSavingQuote] = useState(false);
  // Set while converting an approved quote — the cart came from it, so once
  // the resulting sale saves, the quote gets marked CONVERTED and linked to it.
  const [fromQuoteId, setFromQuoteId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [meName, setMeName] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [storeTaxRateBps, setStoreTaxRateBps] = useState<number | null>(null);
  // Admin only: the store to ring sales from (admins have no assigned store).
  const [stores, setStores] = useState<Store[]>([]);
  const [sellStoreId, setSellStoreId] = useState<string>("");
  const sellStoreLoaded = useRef(false);
  const [company, setCompany] = useState<Company | null>(null);
  const [salespeople, setSalespeople] = useState<{ id: string; name: string }[]>([]);
  const [salespersonId, setSalespersonId] = useState<string>(""); // "" = signed-in operator
  const searchRef = useRef<HTMLInputElement>(null);
  // Guards the persist effect so it can't overwrite saved state before the
  // first load has read it back in.
  const ticketHydrated = useRef(false);

  // An admin has no assigned store, so on-hand counts follow whichever store
  // they've picked to sell from — everyone else's are pinned to their own.
  const storeQs = role === "ADMIN" && sellStoreId ? `&storeId=${encodeURIComponent(sellStoreId)}` : "";

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        api<{ products: Product[] }>(`/api/products?favorite=1&take=5000${storeQs}`),
        api<{ categories: Category[] }>("/api/categories"),
      ]);
      setFavorites(p.products);
      setCategories(c.categories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, [storeQs]);

  const loadAllProducts = useCallback(async () => {
    try {
      const r = await api<{ products: Product[] }>(`/api/products?take=5000${storeQs}`);
      setAllProducts(r.products);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load products");
    }
  }, [storeQs]);

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

  const loadHeld = useCallback(async () => {
    try {
      const res = await api<{ heldSales: HeldSaleSummary[] }>("/api/held-sales");
      setHeld(res.heldSales);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    loadCatalog();
    loadShift();
    loadCustomers();
    loadHeld();
    api<{
      user: {
        id: string;
        name?: string | null;
        role: Role;
        storeName?: string | null;
        storeTaxRateBps?: number | null;
      } | null;
    }>("/api/auth/me")
      .then((r) => {
        setRole(r.user?.role ?? null);
        setMeId(r.user?.id ?? null);
        setMeName(r.user?.name ?? null);
        setStoreName(r.user?.storeName ?? null);
        setStoreTaxRateBps(r.user?.storeTaxRateBps ?? null);
        if (r.user?.role === "ADMIN") {
          api<{ stores: Store[] }>("/api/stores")
            .then((s) => setStores(s.stores))
            .catch(() => {});
        }
      })
      .catch(() => {});
    api<{ company: Company }>("/api/company")
      .then((r) => setCompany(r.company))
      .catch(() => {});
    api<{ people: { id: string; name: string }[] }>("/api/salespeople")
      .then((r) => setSalespeople(r.people))
      .catch(() => {});
  }, [loadCatalog, loadShift, loadCustomers, loadHeld]);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  // Arriving from "Convert to invoice" on an approved quote (/?fromQuote=id):
  // load its items into the cart, then drop the param from the URL.
  useEffect(() => {
    const qid = new URLSearchParams(window.location.search).get("fromQuote");
    if (qid) {
      loadQuoteIntoCart(qid);
      window.history.replaceState(null, "", "/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rehydrate the in-progress ticket from the last visit.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const raw = localStorage.getItem(TICKET_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<TicketSnapshot>;
        if (Array.isArray(s.cart) && s.cart.length > 0) {
          setCart(s.cart as CartLine[]);
          setShippingCents(s.shippingCents ?? 0);
          setCustId(s.custId ?? null);
          setCustName(s.custName ?? "");
          setCustEmail(s.custEmail ?? "");
          setCustPhone(s.custPhone ?? "");
          setCustAddress(s.custAddress ?? "");
          setCustCompany(s.custCompany ?? "");
          setSalespersonId(s.salespersonId ?? "");
        }
      }
    } catch {
      /* ignore malformed/unavailable storage */
    }
    ticketHydrated.current = true;
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Save the ticket on every change; drop it once the cart is empty.
  useEffect(() => {
    if (!ticketHydrated.current) return;
    try {
      if (cart.length === 0) {
        localStorage.removeItem(TICKET_KEY);
        return;
      }
      const snap: TicketSnapshot = {
        cart,
        shippingCents,
        custId,
        custName,
        custEmail,
        custPhone,
        custAddress,
        custCompany,
        salespersonId,
      };
      localStorage.setItem(TICKET_KEY, JSON.stringify(snap));
    } catch {
      /* storage full or unavailable — non-fatal */
    }
  }, [
    cart,
    shippingCents,
    custId,
    custName,
    custEmail,
    custPhone,
    custAddress,
    custCompany,
    salespersonId,
  ]);

  // A line may never be priced below its minimum (UMRP). Rather than snapping
  // on every keystroke (which makes the field impossible to edit), this runs
  // only when the user commits an edit — see snapLineToUmrp, wired to the
  // price/discount inputs' onCommit.
  function snapLineToUmrp(productId: string) {
    setCart((cur) =>
      cur.map((l) => {
        if (l.product.id !== productId) return l;
        const umrp = l.product.umrpCents ?? 0;
        if (umrp <= 0 || l.quantity <= 0) return l;
        if (lineNetCents(l) >= umrp * l.quantity) return l;
        // Below the floor — pin the unit price to the minimum, drop the discount.
        return {
          ...l,
          unitPriceCents: umrp,
          discountCents: 0,
          discPercent: 0,
          discMode: "AMOUNT" as const,
        };
      }),
    );
  }

  function pickCustomer(name: string) {
    setCustName(name);
    const match = customers.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (match) {
      setCustId(match.id);
      setCustEmail(match.email);
      setCustPhone(formatPhone(match.phone));
      setCustAddress(match.address);
      setCustCompany(match.company);
    } else {
      setCustId(null);
    }
  }

  // Register customer search — matches any field, not just the name.
  const custMatches = useMemo(() => {
    const q = custName.trim().toLowerCase();
    if (!q || custId) return [];
    const qd = phoneDigits(q);
    return customers
      .filter(
        (c) =>
          [c.name, c.company, c.phone, c.email, c.address].some((v) =>
            (v ?? "").toLowerCase().includes(q),
          ) || (qd.length >= 2 && phoneDigits(c.phone).includes(qd)),
      )
      .slice(0, 8);
  }, [customers, custName, custId]);

  function selectCustomer(c: Customer) {
    setCustName(c.name);
    setCustId(c.id);
    setCustEmail(c.email);
    setCustPhone(formatPhone(c.phone));
    setCustAddress(c.address);
    setCustCompany(c.company);
    setCustMenuOpen(false);
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
          `/api/products?q=${encodeURIComponent(q)}&take=80${storeQs}`,
        );
        setSearchHits(r.products);
      } catch {
        setSearchHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, storeQs]);

  const isSearching = query.trim().length > 0;

  const filtered = useMemo(() => {
    const source = isSearching
      ? (searchHits ?? [])
      : browseAll
        ? (allProducts ?? [])
        : favorites;
    return source.filter((p) => !activeCategory || p.categoryId === activeCategory);
  }, [isSearching, searchHits, browseAll, allProducts, favorites, activeCategory]);

  // An admin has no assigned store and picks one to sell from; everyone else
  // sells from their own store. The picked store's name and tax rate drive the
  // register.
  const isAdmin = role === "ADMIN";
  const sellStore = isAdmin ? (stores.find((s) => s.id === sellStoreId) ?? null) : null;
  const baseTaxRateBps = isAdmin ? (sellStore?.taxRateBps ?? null) : storeTaxRateBps;

  useEffect(() => {
    try {
      const saved = localStorage.getItem("cbpos.sellStoreId");
      if (saved) setSellStoreId(saved);
    } catch {
      /* private mode / storage disabled — fine */
    }
    sellStoreLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!sellStoreLoaded.current) return;
    try {
      localStorage.setItem("cbpos.sellStoreId", sellStoreId);
    } catch {
      /* ignore */
    }
  }, [sellStoreId]);

  // An admin switching which store they're selling from changes both the tax
  // rate (handled above via `sellStore`) and on-hand counts — refresh whatever
  // product lists are currently in view so stock isn't shown from the wrong store.
  useEffect(() => {
    if (!isAdmin) return;
    loadCatalog();
    if (browseAll) loadAllProducts();
  }, [isAdmin, sellStoreId, loadCatalog, loadAllProducts, browseAll]);

  // A selected tax-exempt customer (cert not past its expiry) zeroes the tax
  // and gives the invoice a due date from their payment terms.
  const selectedCustomer = custId ? (customers.find((c) => c.id === custId) ?? null) : null;
  // A customer with payment terms is invoiced (billed later), not charged now.
  const invoiceCustomer = !!selectedCustomer?.paymentTerms;
  const invoiceDueLabel = (() => {
    if (!invoiceCustomer) return "";
    const d = dueDateFromTerms(new Date(), selectedCustomer!.paymentTerms);
    return d ? d.toLocaleDateString() : "";
  })();
  const taxExemptActive =
    !!selectedCustomer?.taxExempt &&
    (!selectedCustomer.taxExemptExpiresAt ||
      new Date(selectedCustomer.taxExemptExpiresAt) >= new Date(new Date().toDateString()));
  const effectiveTaxRateBps = taxExemptActive ? 0 : (baseTaxRateBps ?? 0);

  const totals = useMemo(() => {
    let subtotal = 0; // catalog list value
    let lineAdjust = 0; // list − charged, per line (negative = priced above list)
    const perLineAfter: number[] = [];
    for (const line of cart) {
      const list = lineListCents(line);
      const net = lineNetCents(line);
      subtotal += list;
      lineAdjust += list - net;
      perLineAfter.push(net);
    }
    const sumAfterLine = perLineAfter.reduce((a, b) => a + b, 0);
    const rateBps = effectiveTaxRateBps;

    let tax = 0;
    const umrpViolations: {
      productId: string;
      name: string;
      minEachCents: number;
      eachCents: number;
    }[] = [];
    cart.forEach((line, idx) => {
      const net = perLineAfter[idx];
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

    // Products with no cost set can't be sold — surfaced here and blocked on
    // the server.
    const noCostItems = cart
      .filter((l) => (l.product.costCents ?? 0) <= 0)
      .map((l) => ({ productId: l.product.id, name: l.product.name }));

    const discount = lineAdjust;
    const shipping = Math.max(0, shippingCents);
    const total = subtotal - discount + tax + shipping;
    // "Customer total saving" vs. catalog list — only when it's actually a saving.
    // A ticket priced above list is never surfaced as such.
    const savedCents = Math.max(0, discount);
    const savedPct = subtotal > 0 ? (savedCents / subtotal) * 100 : 0;
    return {
      subtotal,
      discount,
      tax,
      shipping,
      total,
      umrpViolations,
      noCostItems,
      sumAfterLine,
      orderDiscountResolved: 0,
      savedCents,
      savedPct,
    };
  }, [cart, effectiveTaxRateBps, shippingCents]);

  function addToCart(product: Product) {
    setError(null);
    // Clear the search so the results grid collapses and the ticket is right
    // there — no scrolling past a long list of hits.
    setQuery("");
    setFlashId(product.id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 800);
    setCart((cur) => {
      const idx = cur.findIndex((l) => l.product.id === product.id);
      if (idx >= 0) {
        const next = [...cur];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        ...cur,
        {
          product,
          quantity: 1,
          unitPriceCents: product.priceCents,
          discountCents: 0,
          discPercent: 0,
          discMode: "AMOUNT" as const,
        },
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
        const base = linePricedCents(l);
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

  // Edit the line's total directly — sets the per-unit price (up or down) and
  // clears any separate discount so the field shows exactly what's charged.
  function setLineTotal(productId: string, totalCents: number) {
    setCart((cur) =>
      cur.map((l) => {
        if (l.product.id !== productId || l.quantity <= 0) return l;
        const unit = Math.max(0, Math.round(Math.max(0, totalCents) / l.quantity));
        return {
          ...l,
          unitPriceCents: unit,
          discMode: "AMOUNT",
          discountCents: 0,
          discPercent: 0,
        };
      }),
    );
  }

  // Reset a line's price back to the catalog price.
  function resetLinePrice(productId: string) {
    setCart((cur) =>
      cur.map((l) =>
        l.product.id === productId ? { ...l, unitPriceCents: l.product.priceCents } : l,
      ),
    );
  }

  function clearCart() {
    setCart([]);
    setShippingCents(0);
    clearCustomer();
  }

  function customerPayload() {
    if (custId) return { customerId: custId };
    if (custName.trim())
      return {
        customer: {
          name: custName.trim(),
          email: custEmail.trim(),
          phone: custPhone.trim(),
          address: custAddress.trim(),
          company: custCompany.trim(),
        },
      };
    return {};
  }

  // Park the current cart so it can be recalled later on another device.
  async function holdSale() {
    if (cart.length === 0 || holding) return;
    setHolding(true);
    setError(null);
    try {
      await api("/api/held-sales", {
        method: "POST",
        body: JSON.stringify({
          items: cart.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            discountCents: resolveLineDiscount(l),
            unitPriceCents: l.unitPriceCents,
          })),
          label: custName.trim() || cart[0]?.product.name || "",
          orderDiscountCents: totals.orderDiscountResolved,
          shippingCents: totals.shipping,
          ...(salespersonId && salespersonId !== meId ? { salespersonId } : {}),
          ...customerPayload(),
        }),
      });
      clearCart();
      loadHeld();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not hold the sale");
    } finally {
      setHolding(false);
    }
  }

  // Pull a held sale back into the register (and off the queue).
  async function recallHeld(id: string) {
    if (cart.length > 0 && !confirm("Replace the current sale with the held one?")) return;
    setError(null);
    try {
      const res = await api<HeldSaleDetail>(`/api/held-sales/${id}`);
      const byId = new Map(res.products.map((p) => [p.id, p]));
      const lines: CartLine[] = [];
      for (const l of res.heldSale.items) {
        const product = byId.get(l.productId);
        if (!product) continue; // product was removed after it was held
        lines.push({
          product,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          discountCents: l.discountCents,
          discPercent: 0,
          discMode: "AMOUNT",
        });
      }
      if (lines.length === 0) {
        setError("None of the held items are still available.");
        await api(`/api/held-sales/${id}`, { method: "DELETE" }).catch(() => {});
        setHeldOpen(false);
        loadHeld();
        return;
      }
      setCart(lines);
      setShippingCents(res.heldSale.shippingCents);
      setCustId(res.heldSale.customerId);
      setCustName(res.heldSale.customerName);
      setCustEmail(res.heldSale.customerEmail);
      setCustPhone(res.heldSale.customerPhone);
      setCustAddress(res.heldSale.customerAddress);
      setCustCompany(res.heldSale.customerCompany);
      setCustOpen(false);
      setSalespersonId(
        res.heldSale.salespersonId && res.heldSale.salespersonId !== meId
          ? res.heldSale.salespersonId
          : "",
      );
      await api(`/api/held-sales/${id}`, { method: "DELETE" }).catch(() => {});
      setHeldOpen(false);
      loadHeld();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not recall the held sale");
    }
  }

  async function discardHeld(id: string) {
    if (!confirm("Discard this held sale?")) return;
    try {
      await api(`/api/held-sales/${id}`, { method: "DELETE" });
      loadHeld();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not discard the held sale");
    }
  }

  // Load an approved quote's items into the cart to finish it as an invoice.
  // The quote itself isn't touched yet — it's marked CONVERTED (and linked to
  // the resulting sale) once that sale actually saves, in afterSaleSaved.
  async function loadQuoteIntoCart(id: string) {
    if (cart.length > 0 && !confirm("Replace the current sale with this quote?")) return;
    setError(null);
    try {
      const res = await api<{ quote: Quote; products: Product[] }>(`/api/quotes/${id}`);
      if (res.quote.status !== "APPROVED") {
        setError("Approve the quote before converting it to an invoice.");
        return;
      }
      const byId = new Map(res.products.map((p) => [p.id, p]));
      const lines: CartLine[] = [];
      for (const l of res.quote.items) {
        const product = byId.get(l.productId);
        if (!product) continue; // product was removed since the quote was made
        lines.push({
          product,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          discountCents: l.discountCents,
          discPercent: 0,
          discMode: "AMOUNT",
        });
      }
      if (lines.length === 0) {
        setError("None of the quoted items are still available.");
        return;
      }
      setCart(lines);
      setShippingCents(res.quote.shippingCents);
      setCustId(res.quote.customerId ?? null);
      setCustName(res.quote.customerNameSnapshot ?? "");
      setCustEmail(res.quote.customerEmailSnapshot ?? "");
      setCustPhone(res.quote.customerPhoneSnapshot ?? "");
      setCustAddress(res.quote.customerAddressSnapshot ?? "");
      setCustCompany(res.quote.customerCompanySnapshot ?? "");
      setCustOpen(false);
      setFromQuoteId(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the quote");
    }
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

  function setLineSerial(productId: string, serialNumber: string) {
    setCart((cur) => cur.map((l) => (l.product.id === productId ? { ...l, serialNumber } : l)));
  }

  function salePayloadBase() {
    return {
      items: cart.map((l) => ({
        productId: l.product.id,
        quantity: l.quantity,
        discountCents: resolveLineDiscount(l),
        unitPriceCents: l.unitPriceCents,
        ...(l.serialNumber?.trim() ? { serialNumber: l.serialNumber.trim() } : {}),
      })),
      orderDiscountCents: totals.orderDiscountResolved,
      shippingCents: totals.shipping,
      ...(isAdmin && sellStoreId ? { storeId: sellStoreId } : {}),
      ...(salespersonId && salespersonId !== meId ? { salespersonId } : {}),
      ...customerPayload(),
    };
  }

  function afterSaleSaved(sale: Sale) {
    setReceipt(sale);
    setPayOpen(false);
    clearCart();
    loadCatalog();
    if (allProducts) loadAllProducts();
    loadShift();
    loadCustomers();
    // This sale came from converting a quote — mark it converted and linked.
    if (fromQuoteId) {
      const qid = fromQuoteId;
      setFromQuoteId(null);
      api(`/api/quotes/${qid}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "CONVERTED", convertedSaleId: sale.id }),
      }).catch(() => {});
    }
  }

  // Save the current cart as a quote instead of a sale — no payment, no
  // inventory movement. Same UMRP / cost rules as a sale apply server-side.
  async function saveQuote() {
    if (cart.length === 0 || savingQuote) return;
    setError(null);
    if (isAdmin && !sellStoreId) {
      setError("Choose a store to sell from.");
      return;
    }
    setSavingQuote(true);
    try {
      await api("/api/quotes", { method: "POST", body: JSON.stringify(salePayloadBase()) });
      clearCart();
      router.push("/quotes");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the quote");
    } finally {
      setSavingQuote(false);
    }
  }

  // Terms customer: save the sale as an unpaid invoice — no payment taken now.
  async function saveInvoice() {
    setError(null);
    if (isAdmin && !sellStoreId) {
      setError("Choose a store to sell from.");
      return;
    }
    try {
      const res = await api<{ sale: Sale }>("/api/sales", {
        method: "POST",
        body: JSON.stringify(salePayloadBase()),
      });
      afterSaleSaved(res.sale);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the invoice");
    }
  }

  // Take a deposit / part-payment now; the rest is billed as an invoice.
  async function takeDeposit(
    method: "CASH" | "CARD" | "CHECK" | "CREDIT",
    depositCents: number,
    tenderedCents: number,
    checkNumber?: string,
  ) {
    setError(null);
    if (isAdmin && !sellStoreId) {
      setError("Choose a store to sell from.");
      return;
    }
    try {
      const res = await api<{ sale: Sale }>("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          ...salePayloadBase(),
          depositCents,
          depositMethod: method,
          tenderedCents,
          ...(method === "CHECK" ? { checkNumber } : {}),
        }),
      });
      afterSaleSaved(res.sale);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not take the deposit");
    }
  }

  // Split tender — e.g. store credit + card for the rest — in one completed sale.
  async function completeSaleSplit(
    payments: {
      method: "CASH" | "CARD" | "CHECK" | "CREDIT";
      amountCents: number;
      tenderedCents: number;
      checkNumber?: string;
    }[],
  ) {
    setError(null);
    if (isAdmin && !sellStoreId) {
      setError("Choose a store to sell from.");
      return;
    }
    try {
      const res = await api<{ sale: Sale }>("/api/sales", {
        method: "POST",
        body: JSON.stringify({ ...salePayloadBase(), payments }),
      });
      afterSaleSaved(res.sale);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not complete the sale");
    }
  }

  async function completeSale(
    paymentMethod: "CASH" | "CARD" | "CHECK" | "CREDIT",
    tenderedCents: number,
    checkNumber?: string,
  ) {
    setError(null);
    if (isAdmin && !sellStoreId) {
      setError("Choose a store to sell from.");
      return;
    }
    try {
      const res = await api<{ sale: Sale }>("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          ...salePayloadBase(),
          paymentMethod,
          tenderedCents,
          ...(paymentMethod === "CHECK" ? { checkNumber } : {}),
        }),
      });
      afterSaleSaved(res.sale);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not complete the sale");
    }
  }

  return (
    <div className="grid w-full flex-1 gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-4">
      {/* Catalog */}
      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="mb-3 flex gap-2">
          <input
            ref={searchRef}
            className="input min-w-0"
            placeholder="Search name, SKU, or scan barcode…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            autoFocus
          />
          <button
            type="button"
            onClick={() => setCatalogOpen((o) => !o)}
            aria-expanded={catalogOpen}
            className="btn-secondary shrink-0"
          >
            {catalogOpen ? "Hide catalog" : "Open catalog"}
          </button>
        </div>

        {/* Category filters only when the catalog is explicitly open — a search
           should show its results, not a wall of category chips. */}
        {catalogOpen && (
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
            {!isSearching && (
              <button
                onClick={toggleBrowseAll}
                className={browseAll ? "btn-primary" : "btn-secondary"}
              >
                {browseAll ? "Favorites only" : "Browse all"}
              </button>
            )}
          </div>
        )}

        {(isSearching || catalogOpen) &&
          (loading ? (
            <p className="text-sm text-zinc-500">Loading catalog…</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 overflow-y-auto pb-4 sm:grid-cols-3 xl:grid-cols-4">
              {filtered.map((p) => {
                const low = p.trackStock && p.stock <= 0;
                const inCart = cart.find((l) => l.product.id === p.id)?.quantity ?? 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className={`card relative flex min-w-0 flex-col items-start gap-1 p-3 text-left transition-transform hover:-translate-y-0.5 hover:shadow-md ${
                      inCart > 0 ? "ring-2 ring-green-500" : ""
                    }`}
                  >
                    {inCart > 0 && (
                      <span className="absolute right-1.5 top-1.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-green-600 px-1 text-[11px] font-bold text-white">
                        {inCart}
                      </span>
                    )}
                    {flashId === p.id && (
                      <span className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-lg bg-green-600/90 text-sm font-semibold text-white">
                        Added ✓
                      </span>
                    )}
                    <span className="line-clamp-2 w-full break-words text-sm font-medium">
                      {p.name}
                    </span>
                    <span className="w-full break-all text-xs text-zinc-400">{p.sku}</span>
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
                <div className="col-span-full flex flex-col items-start gap-2 text-sm text-zinc-500">
                  <p>No matching products.</p>
                  {isSearching && !searching && (
                    <button
                      type="button"
                      onClick={() => setQuickAddOpen(true)}
                      className="btn-secondary"
                    >
                      Add &ldquo;{query.trim()}&rdquo; as a new product
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
      </section>

      {/* Ticket */}
      <section className="flex min-h-0 min-w-0 flex-col gap-3">
        <ShiftWidget shift={shift} stats={shiftStats} onChanged={loadShift} />

        <div className="card flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <div className="min-w-0">
              <h2 className="font-semibold">Current sale</h2>
              {isAdmin ? (
                <div className="mt-0.5 flex items-center gap-1.5">
                  <select
                    className={`input h-7 w-auto min-w-44 text-xs ${
                      sellStoreId ? "" : "border-amber-400 text-amber-700"
                    }`}
                    value={sellStoreId}
                    onChange={(e) => setSellStoreId(e.target.value)}
                  >
                    <option value="">Choose store to sell from…</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {sellStore && (
                    <span className="whitespace-nowrap text-[11px] text-zinc-400">
                      tax {formatBps(sellStore.taxRateBps)}
                    </span>
                  )}
                </div>
              ) : (
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
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {held.length > 0 && (
                <button onClick={() => setHeldOpen(true)} className="btn-ghost text-xs">
                  Held ({held.length})
                </button>
              )}
              {cart.length > 0 && (
                <button onClick={clearCart} className="btn-ghost text-xs">
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Salesperson — always available to a manager/admin; for a plain
             cashier only when there's actually someone else to pick. */}
          {(salespeople.length > 1 || role === "MANAGER" || role === "ADMIN") && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-zinc-100 px-4 py-2 text-xs">
              <span className="shrink-0 whitespace-nowrap text-zinc-400">Salesperson</span>
              <select
                className="input h-8 min-w-40 flex-1"
                value={salespersonId}
                onChange={(e) => setSalespersonId(e.target.value)}
              >
                <option value="">
                  {meName ?? salespeople.find((p) => p.id === meId)?.name ?? "Me"}
                </option>
                {salespeople
                  .filter((p) => p.id !== meId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              {salespersonId && salespersonId !== meId && (
                <span className="shrink-0 whitespace-nowrap text-amber-600">credited to another</span>
              )}
            </div>
          )}

          {/* Customer */}
          <div className="border-b border-zinc-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  className="input h-8 w-full"
                  placeholder="Customer — name, company, phone, email…"
                  value={custName}
                  onChange={(e) => {
                    pickCustomer(e.target.value);
                    setCustMenuOpen(true);
                  }}
                  onFocus={() => setCustMenuOpen(true)}
                  onBlur={() => setTimeout(() => setCustMenuOpen(false), 150)}
                />
                {custMenuOpen && custMatches.length > 0 && (
                  <ul className="absolute z-40 mt-1 max-h-60 w-80 overflow-auto rounded-md border border-zinc-200 bg-white text-sm shadow-lg">
                    {custMatches.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectCustomer(c);
                          }}
                          className="block w-full px-3 py-1.5 text-left hover:bg-indigo-50"
                        >
                          <span className="font-medium">{c.company || c.name}</span>
                          {c.company && c.name && (
                            <span className="text-zinc-400"> · {c.name}</span>
                          )}
                          {[c.phone, c.email, c.address].filter(Boolean).length > 0 && (
                            <span className="block truncate text-[11px] text-zinc-400">
                              {[formatPhone(c.phone), c.email, c.address]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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
            {!!selectedCustomer && selectedCustomer.storeCreditCents > 0 && (
              <p className="mt-1 text-[11px] text-indigo-600">
                Store credit available: {formatMoney(selectedCustomer.storeCreditCents)}
              </p>
            )}
            {selectedCustomer?.taxExempt && (
              <p
                className={`mt-1 text-[11px] ${taxExemptActive ? "text-emerald-600" : "text-red-600"}`}
              >
                {taxExemptActive
                  ? "Tax-exempt — no sales tax on this invoice"
                  : "Tax-exempt certificate has expired — sales tax applies"}
              </p>
            )}
            {selectedCustomer?.paymentTerms && (
              <p className="mt-0.5 text-[11px] text-zinc-500">
                Terms: {selectedCustomer.paymentTerms} · invoice due{" "}
                {(() => {
                  const d = dueDateFromTerms(new Date(), selectedCustomer.paymentTerms);
                  return d ? d.toLocaleDateString() : "on receipt";
                })()}
              </p>
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
                  <PhoneInput
                    className="input h-8"
                    value={custPhone}
                    onChange={setCustPhone}
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
                  const listCents = lineListCents(line);
                  const lineDisc = resolveLineDiscount(line);
                  const lineTotal = lineNetCents(line);
                  const unitNow = line.quantity > 0 ? Math.round(lineTotal / line.quantity) : 0;
                  const lineSaved = listCents - lineTotal;
                  const changePct =
                    listCents > 0 ? Math.round((Math.abs(lineSaved) / listCents) * 100) : 0;
                  const priceChanged = line.unitPriceCents !== line.product.priceCents;
                  return (
                  <li key={line.product.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{line.product.name}</p>
                        <p className="text-xs text-zinc-400">
                          List {formatMoney(line.product.priceCents)} ea
                          {(priceChanged || lineDisc > 0) && (
                            <>
                              {" · "}
                              {/* Only ever surface a saving — a line priced above
                                  list shows nothing about being over list. */}
                              {lineSaved > 0 && (
                                <span className="text-green-600">
                                  now {formatMoney(unitNow)} ea · save {formatMoney(lineSaved)} (
                                  {changePct}%)
                                </span>
                              )}
                              {priceChanged && (
                                <button
                                  type="button"
                                  onClick={() => resetLinePrice(line.product.id)}
                                  className="ml-1 text-indigo-600 hover:underline"
                                >
                                  reset
                                </button>
                              )}
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
                          onCommit={() => snapLineToUmrp(line.product.id)}
                          className="input h-7 w-14 shrink-0 px-2 text-right text-xs"
                          aria-label="Discount percent"
                        />
                      ) : (
                        <MoneyInput
                          cents={lineDisc}
                          onCentsChange={(c) => setLineDiscAmount(line.product.id, c)}
                          onCommit={() => snapLineToUmrp(line.product.id)}
                          className="input h-7 w-20 shrink-0 px-2 text-right text-xs"
                        />
                      )}

                      <MoneyInput
                        cents={lineTotal}
                        onCentsChange={(c) => setLineTotal(line.product.id, c)}
                        onCommit={() => snapLineToUmrp(line.product.id)}
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
                    {(line.product.costCents ?? 0) <= 0 && (
                      <p className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">
                        No cost set — enter a cost for this product before it can be sold.
                      </p>
                    )}
                    <input
                      className="input mt-1.5 h-7 w-full text-xs"
                      placeholder="Serial # (optional)"
                      value={line.serialNumber ?? ""}
                      onChange={(e) => setLineSerial(line.product.id, e.target.value)}
                    />
                  </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="space-y-2 border-t border-zinc-100 px-4 py-3 text-sm">
            <Row label="Subtotal (list)" value={formatMoney(totals.subtotal)} />
            {/* Show a discount line only when there's an actual discount — never
                flag a ticket priced above list. */}
            {totals.discount > 0 && (
              <Row label="Discount" value={`− ${formatMoney(totals.discount)}`} />
            )}
            <Row
              label={`Tax${
                taxExemptActive
                  ? " (exempt)"
                  : baseTaxRateBps != null
                    ? ` (${formatBps(baseTaxRateBps)})`
                    : ""
              }`}
              value={formatMoney(totals.tax)}
            />
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Shipping</span>
              <MoneyInput
                cents={shippingCents}
                onCentsChange={setShippingCents}
                className="input h-8 w-24 px-2 text-right"
              />
            </div>
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

            {totals.noCostItems.length > 0 && (
              <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">
                Cost needs to be entered for{" "}
                {totals.noCostItems.map((i) => i.name).join(", ")}. These can&apos;t be sold
                until a cost is set on the product.
              </p>
            )}

            <div className="mt-1 flex gap-2">
              <button
                onClick={holdSale}
                disabled={cart.length === 0 || holding}
                className="btn-secondary flex-1"
              >
                {holding ? "Holding…" : "Hold sale"}
              </button>
              <button
                onClick={saveQuote}
                disabled={
                  cart.length === 0 ||
                  savingQuote ||
                  totals.umrpViolations.length > 0 ||
                  totals.noCostItems.length > 0 ||
                  (isAdmin && !sellStoreId)
                }
                className="btn-secondary flex-1"
                title="Save this cart as a quote for the customer to approve later"
              >
                {savingQuote ? "Saving…" : "Save as quote"}
              </button>
            </div>
            {isAdmin && !sellStoreId && cart.length > 0 && (
              <p className="text-xs text-amber-700">Choose a store to sell from (top of the ticket).</p>
            )}
            {invoiceCustomer && cart.length > 0 && (
              <p className="text-xs text-zinc-500">
                {selectedCustomer!.name} is on {selectedCustomer!.paymentTerms} terms — this saves
                as an unpaid invoice{invoiceDueLabel ? `, due ${invoiceDueLabel}` : ""}. Record the
                payment from the invoice when the money comes in.
              </p>
            )}
            <button
              onClick={() => setPayOpen(true)}
              disabled={
                cart.length === 0 ||
                totals.umrpViolations.length > 0 ||
                totals.noCostItems.length > 0 ||
                (isAdmin && !sellStoreId)
              }
              className="btn-primary w-full py-3 text-base"
            >
              {invoiceCustomer
                ? `Invoice / deposit — ${formatMoney(totals.total)}`
                : `Charge ${formatMoney(totals.total)}`}
            </button>
          </div>
        </div>
      </section>

      {heldOpen && (
        <HeldSalesModal
          held={held}
          onRecall={recallHeld}
          onDiscard={discardHeld}
          onClose={() => setHeldOpen(false)}
        />
      )}

      {payOpen && (
        <PaymentModal
          total={totals.total}
          canDeposit={!!custId || custName.trim().length > 0}
          creditCents={selectedCustomer?.storeCreditCents ?? 0}
          onClose={() => setPayOpen(false)}
          onConfirm={completeSale}
          onDeposit={takeDeposit}
          onSplit={completeSaleSplit}
          onSaveInvoice={invoiceCustomer ? saveInvoice : undefined}
          error={error}
        />
      )}

      {receipt && (
        <ReceiptModal
          sale={receipt}
          company={company}
          onClose={() => setReceipt(null)}
          closeLabel="New sale"
        />
      )}

      {quickAddOpen && (
        <QuickAddProductModal
          initialName={query.trim()}
          categories={categories}
          onClose={() => setQuickAddOpen(false)}
          onCreated={(product) => {
            addToCart(product);
            setQuery("");
            loadCatalog();
            if (allProducts) loadAllProducts();
          }}
        />
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
  const [countCents, setCountCents] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  if (!shift) return null;

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
  canDeposit,
  creditCents,
  onClose,
  onConfirm,
  onDeposit,
  onSplit,
  onSaveInvoice,
  error,
}: {
  total: number;
  canDeposit: boolean;
  creditCents?: number;
  onClose: () => void;
  onConfirm: (
    method: "CASH" | "CARD" | "CHECK" | "CREDIT",
    tenderedCents: number,
    checkNumber?: string,
  ) => Promise<void>;
  onDeposit: (
    method: "CASH" | "CARD" | "CHECK" | "CREDIT",
    depositCents: number,
    tenderedCents: number,
    checkNumber?: string,
  ) => Promise<void>;
  onSplit: (
    payments: {
      method: "CASH" | "CARD" | "CHECK" | "CREDIT";
      amountCents: number;
      tenderedCents: number;
      checkNumber?: string;
    }[],
  ) => Promise<void>;
  onSaveInvoice?: () => Promise<void>;
  error: string | null;
}) {
  const credit = creditCents ?? 0;
  const methods: ("CASH" | "CARD" | "CHECK" | "CREDIT")[] = credit > 0
    ? ["CASH", "CARD", "CHECK", "CREDIT"]
    : ["CASH", "CARD", "CHECK"];
  const [tab, setTab] = useState<"CASH" | "CARD" | "CHECK" | "CREDIT">("CASH");
  const [checkNo, setCheckNo] = useState("");
  const [mode, setMode] = useState<"FULL" | "DEPOSIT">("FULL");
  const [deposit, setDeposit] = useState(total);
  const [tendered, setTendered] = useState(total);
  // How much store credit to apply — defaults to whatever it can cover, editable
  // down for a partial redemption.
  const [creditApply, setCreditApply] = useState(Math.min(credit, total));
  // How the rest of a store-credit split is collected.
  const [restTab, setRestTab] = useState<"CASH" | "CARD">("CARD");
  const [restTendered, setRestTendered] = useState(0);
  const [busy, setBusy] = useState(false);

  const collectNow = mode === "DEPOSIT" ? deposit : total;
  const quick = [collectNow, 2000, 5000, 10000, 20000, 50000];
  const change = Math.max(0, tendered - collectNow);
  const depositValid = deposit >= 1 && deposit <= total;
  // Amount of store credit that will actually be applied on submit.
  const creditNow = Math.min(creditApply, credit, total);
  const creditRemaining = Math.max(0, total - creditNow);

  async function go() {
    setBusy(true);
    try {
      if (tab === "CREDIT") {
        // Store credit + (if it doesn't cover the order) another tender for the
        // rest — all in one completed transaction.
        const payments: { method: "CASH" | "CARD" | "CREDIT"; amountCents: number; tenderedCents: number }[] = [
          { method: "CREDIT", amountCents: creditNow, tenderedCents: creditNow },
        ];
        if (creditRemaining > 0) {
          payments.push({
            method: restTab,
            amountCents: creditRemaining,
            tenderedCents: restTab === "CASH" ? Math.max(restTendered, creditRemaining) : creditRemaining,
          });
        }
        await onSplit(payments);
      } else if (mode === "DEPOSIT") {
        await onDeposit(
          tab,
          deposit,
          tab === "CASH" ? tendered : deposit,
          tab === "CHECK" ? checkNo.trim() : undefined,
        );
      } else {
        await onConfirm(
          tab,
          tab === "CASH" ? tendered : total,
          tab === "CHECK" ? checkNo.trim() : undefined,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-md">
        <h3 className="mb-1 text-lg font-semibold">Take payment</h3>
        <p className="mb-3 text-sm text-zinc-500">
          Order total <span className="font-semibold text-zinc-900">{formatMoney(total)}</span>
        </p>

        {canDeposit && tab !== "CREDIT" && (
          <div className="mb-4 flex gap-1 rounded-md bg-zinc-100 p-1 text-sm">
            {(["FULL", "DEPOSIT"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded px-3 py-1.5 font-medium ${
                  mode === m ? "bg-white shadow-sm" : "text-zinc-500"
                }`}
              >
                {m === "FULL" ? "Pay in full" : "Take a deposit"}
              </button>
            ))}
          </div>
        )}

        {mode === "DEPOSIT" && tab !== "CREDIT" && (
          <div className="mb-4 space-y-1">
            <label className="label">Deposit amount</label>
            <MoneyInput cents={deposit} onCentsChange={setDeposit} autoFocus />
            <p className="text-xs text-zinc-500">
              Balance billed as an invoice:{" "}
              <span className="font-medium">{formatMoney(Math.max(0, total - deposit))}</span>
            </p>
          </div>
        )}

        <div className="mb-4 flex gap-1 rounded-md bg-zinc-100 p-1">
          {methods.map((m) => (
            <button
              key={m}
              onClick={() => setTab(m)}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${
                tab === m ? "bg-white shadow-sm" : "text-zinc-500"
              }`}
            >
              {m === "CASH"
                ? "Cash"
                : m === "CARD"
                  ? "Card"
                  : m === "CHECK"
                    ? "Check"
                    : "Store credit"}
            </button>
          ))}
        </div>

        {tab === "CASH" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {quick.map((c, i) => (
                <button key={i} onClick={() => setTendered(c)} className="btn-secondary">
                  {i === 0 ? "Exact" : formatMoney(c)}
                </button>
              ))}
            </div>
            <div>
              <label className="label">Cash received</label>
              <MoneyInput cents={tendered} onCentsChange={setTendered} />
            </div>
            <div className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-sm">
              <span className="text-zinc-500">Change due</span>
              <span className="text-lg font-bold">{formatMoney(change)}</span>
            </div>
          </div>
        ) : tab === "CREDIT" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-sm">
              <span className="text-zinc-500">Store credit available</span>
              <span className="font-semibold">{formatMoney(credit)}</span>
            </div>
            <div>
              <label className="label">Apply from store credit</label>
              <div className="flex gap-2">
                <MoneyInput cents={creditApply} onCentsChange={setCreditApply} />
                <button
                  type="button"
                  onClick={() => setCreditApply(Math.min(credit, total))}
                  className="btn-secondary shrink-0 text-xs"
                >
                  Max
                </button>
              </div>
            </div>
            {creditRemaining > 0 && (
              <div className="rounded-md border border-zinc-200 p-3">
                <p className="mb-2 text-sm">
                  Remaining balance{" "}
                  <span className="font-semibold">{formatMoney(creditRemaining)}</span> — pay it now
                  with:
                </p>
                <div className="mb-2 flex gap-1 rounded-md bg-zinc-100 p-1 text-sm">
                  {(["CASH", "CARD"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setRestTab(m)}
                      className={`flex-1 rounded px-3 py-1 font-medium ${
                        restTab === m ? "bg-white shadow-sm" : "text-zinc-500"
                      }`}
                    >
                      {m === "CASH" ? "Cash" : "Card"}
                    </button>
                  ))}
                </div>
                {restTab === "CASH" ? (
                  <div className="space-y-2">
                    <MoneyInput
                      cents={restTendered}
                      onCentsChange={setRestTendered}
                      placeholder={(creditRemaining / 100).toFixed(2)}
                    />
                    <div className="flex justify-between text-xs text-zinc-500">
                      <span>Change due</span>
                      <span className="font-semibold">
                        {formatMoney(Math.max(0, restTendered - creditRemaining))}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">Run the card, then confirm below.</p>
                )}
                <button
                  type="button"
                  onClick={() => onDeposit("CREDIT", creditNow, creditNow)}
                  className="btn-ghost mt-2 w-full text-[11px]"
                >
                  or bill the {formatMoney(creditRemaining)} balance as an invoice
                </button>
              </div>
            )}
          </div>
        ) : tab === "CHECK" ? (
          <div className="space-y-1">
            <label className="label">Check number</label>
            <input
              className="input"
              value={checkNo}
              onChange={(e) => setCheckNo(e.target.value)}
              placeholder="e.g. 1042"
              autoFocus
              inputMode="numeric"
            />
            <p className="text-xs text-zinc-500">
              Record the customer&apos;s check number, then confirm.
            </p>
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
            disabled={
              busy ||
              (tab === "CREDIT" &&
                (creditNow < 1 ||
                  (creditRemaining > 0 && restTab === "CASH" && restTendered < creditRemaining))) ||
              (tab !== "CREDIT" && mode === "DEPOSIT" && !depositValid) ||
              (tab === "CASH" && tendered < collectNow) ||
              (tab === "CHECK" && !checkNo.trim())
            }
            className="btn-primary flex-1"
          >
            {busy
              ? "Processing…"
              : tab === "CREDIT"
                ? creditRemaining > 0
                  ? `Complete sale — ${formatMoney(total)}`
                  : `Pay ${formatMoney(creditNow)} with credit`
                : mode === "DEPOSIT"
                  ? `Take deposit ${formatMoney(deposit)}`
                  : "Complete sale"}
          </button>
        </div>

        {onSaveInvoice && (
          <button
            onClick={async () => {
              setBusy(true);
              try {
                await onSaveInvoice();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="btn-ghost mt-2 w-full text-xs"
          >
            Save as invoice — bill later, no payment now
          </button>
        )}
      </div>
    </Overlay>
  );
}

function HeldSalesModal({
  held,
  onRecall,
  onDiscard,
  onClose,
}: {
  held: HeldSaleSummary[];
  onRecall: (id: string) => void;
  onDiscard: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-md">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Held sales</h3>
          <button onClick={onClose} className="btn-ghost px-2 py-1 text-sm">
            ✕
          </button>
        </div>
        {held.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No held sales.</p>
        ) : (
          <ul className="space-y-2">
            {held.map((h) => (
              <li key={h.id} className="rounded-md border border-zinc-200 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {h.label || h.customerName || "Untitled sale"}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {h.itemCount} item{h.itemCount === 1 ? "" : "s"} ·{" "}
                      {formatMoney(h.approxTotalCents)}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {h.salespersonName ?? h.createdByName} ·{" "}
                      {new Date(h.createdAt).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button onClick={() => onRecall(h.id)} className="btn-primary h-8 text-xs">
                      Recall
                    </button>
                    <button
                      onClick={() => onDiscard(h.id)}
                      className="btn-ghost h-8 text-xs text-red-500"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="card max-h-[90vh] w-full max-w-md overflow-y-auto p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
