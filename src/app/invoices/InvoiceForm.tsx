"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { todayInputValue } from "@/lib/date";
import { matchesSearch } from "@/lib/search";
import { MoneyInput } from "@/components/MoneyInput";
import { PercentInput } from "@/components/PercentInput";
import { QuickAddProductModal } from "@/components/QuickAddProductModal";
import { ReceiptModal } from "@/components/ReceiptModal";
import { PaymentMethodSelect, usePaymentMethods } from "@/components/PaymentMethodPicker";
import type { Category, Customer, Product, Sale, Store } from "@/lib/types";

type ProductLite = {
  id: string;
  name: string;
  sku: string;
  priceCents: number;
  description: string | null;
  vendor: string;
};

type DiscMode = "AMOUNT" | "PERCENT";

type Line = {
  key: string;
  productId: string | null;
  productName: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
  // Resolved $ discount when discMode is AMOUNT; derived from discPercent
  // (via resolveLineDiscount) when PERCENT — same split as the register.
  discountCents: number;
  discPercent: number;
  discMode: DiscMode;
  serialNumber: string;
};

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());

const blankLine = (): Line => ({
  key: uid(),
  productId: null,
  productName: "",
  sku: "",
  quantity: 1,
  unitPriceCents: 0,
  discountCents: 0,
  discPercent: 0,
  discMode: "AMOUNT",
  serialNumber: "",
});

/** The line's $ discount, resolved from whichever of $/% is active. */
function resolveLineDiscount(l: Line): number {
  const base = l.quantity * l.unitPriceCents;
  const raw = l.discMode === "PERCENT" ? Math.round((base * l.discPercent) / 100) : l.discountCents;
  return Math.max(0, Math.min(base, raw));
}

// Keeps an in-progress invoice across an accidental sign-out (the idle
// timer, a dropped session) — nothing typed in is lost when logging back in.
// One slot per browser; keyed to the signed-in user so a different person
// logging in on the same device doesn't inherit it.
const DRAFT_KEY = "cbpos.invoiceDraft";

type InvoiceDraft = {
  userId: string;
  storeId: string;
  manualNumber: string;
  manualDate: string;
  custId: string | null;
  custName: string;
  custEmail: string;
  custPhone: string;
  custCompany: string;
  custAddress: string;
  lines: Line[];
  orderDiscountCents: number;
  shippingCents: number;
  leaveUnpaid: boolean;
  paymentMethod: string;
  amountReceived: number | null;
  tenderedCents: number;
  checkNumber: string;
  paymentNote: string;
};

/**
 * A full-page invoice entry form — for the back office, not the register:
 * pick/add a customer, pick/add products (with cost/vendor via the usual
 * quick-add), line + order discounts, shipping, and a payment (or leave it
 * unpaid). Admins can also set the real invoice # and backdate it, for
 * entering an invoice that's being migrated from another system.
 */
export function InvoiceForm({
  role,
  userId,
}: {
  role: "CASHIER" | "MANAGER" | "ADMIN";
  userId: string;
}) {
  const router = useRouter();
  const isAdmin = role === "ADMIN";

  const [products, setProducts] = useState<ProductLite[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Admin-only: which store this invoice is rung at, and manual overrides for
  // entering a historical invoice under its real number/date.
  const [storeId, setStoreId] = useState("");
  const [manualNumber, setManualNumber] = useState("");
  const [manualDate, setManualDate] = useState("");

  // Bill-to customer — pick an existing one, or type a new name/details and
  // it's created automatically (same as the register).
  const [custId, setCustId] = useState<string | null>(null);
  const [custName, setCustName] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custCompany, setCustCompany] = useState("");
  const [custAddress, setCustAddress] = useState("");
  const [custOpen, setCustOpen] = useState(false);
  const custInputRef = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [quickAddRowKey, setQuickAddRowKey] = useState<string | null>(null);

  const [orderDiscountCents, setOrderDiscountCents] = useState(0);
  const [shippingCents, setShippingCents] = useState(0);

  const [leaveUnpaid, setLeaveUnpaid] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentMethods, setPaymentMethods] = usePaymentMethods();
  // null = "the full amount" — kept in sync with the live total until typed in.
  const [amountReceived, setAmountReceived] = useState<number | null>(null);
  const [tenderedCents, setTenderedCents] = useState(0);
  const [checkNumber, setCheckNumber] = useState("");
  // No card reader on this back-office form — a Card payment here is always
  // just a record of a charge taken elsewhere (the website's own checkout,
  // a standalone terminal, …), never a live Stripe charge. This is where
  // that reference/confirmation # goes.
  const [paymentNote, setPaymentNote] = useState("");

  // Non-admin: the operator's own store (name + tax rate), shown for parity
  // with the register. An admin instead picks one below — required, since
  // it's what sets the tax rate (same rule as the register).
  const [myStoreName, setMyStoreName] = useState<string | null>(null);
  const [myStoreTaxRateBps, setMyStoreTaxRateBps] = useState<number | null>(null);

  const [previewTotalCents, setPreviewTotalCents] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [savedSale, setSavedSale] = useState<{ id: string; number: number } | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [p, c, cu] = await Promise.all([
          api<{ products: ProductLite[] }>("/api/products?take=5000"),
          api<{ categories: Category[] }>("/api/categories"),
          api<{ customers: Customer[] }>("/api/customers"),
        ]);
        setProducts(p.products);
        setCategories(c.categories);
        setCustomers(cu.customers);
        if (isAdmin) {
          const s = await api<{ stores: Store[] }>("/api/stores");
          setStores(s.stores);
        } else {
          const me = await api<{
            user: { storeName?: string | null; storeTaxRateBps?: number | null } | null;
          }>("/api/auth/me");
          setMyStoreName(me.user?.storeName ?? null);
          setMyStoreTaxRateBps(me.user?.storeTaxRateBps ?? null);
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore an in-progress draft left from before a sign-out/reload — once,
  // on mount, before the save effect below starts overwriting it.
  const draftHydrated = useRef(false);
  useEffect(() => {
    if (draftHydrated.current) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<InvoiceDraft>;
        if (d.userId !== userId) {
          localStorage.removeItem(DRAFT_KEY);
        } else {
          if (d.storeId !== undefined) setStoreId(d.storeId);
          if (d.manualNumber !== undefined) setManualNumber(d.manualNumber);
          if (d.manualDate !== undefined) setManualDate(d.manualDate);
          if (d.custId !== undefined) setCustId(d.custId);
          if (d.custName !== undefined) setCustName(d.custName);
          if (d.custEmail !== undefined) setCustEmail(d.custEmail);
          if (d.custPhone !== undefined) setCustPhone(d.custPhone);
          if (d.custCompany !== undefined) setCustCompany(d.custCompany);
          if (d.custAddress !== undefined) setCustAddress(d.custAddress);
          if (Array.isArray(d.lines) && d.lines.length > 0) setLines(d.lines);
          if (d.orderDiscountCents !== undefined) setOrderDiscountCents(d.orderDiscountCents);
          if (d.shippingCents !== undefined) setShippingCents(d.shippingCents);
          if (d.leaveUnpaid !== undefined) setLeaveUnpaid(d.leaveUnpaid);
          if (d.paymentMethod !== undefined) setPaymentMethod(d.paymentMethod);
          if (d.amountReceived !== undefined) setAmountReceived(d.amountReceived);
          if (d.tenderedCents !== undefined) setTenderedCents(d.tenderedCents);
          if (d.checkNumber !== undefined) setCheckNumber(d.checkNumber);
          if (d.paymentNote !== undefined) setPaymentNote(d.paymentNote);
        }
      }
    } catch {
      /* ignore malformed/unavailable storage */
    }
    draftHydrated.current = true;
  }, [userId]);

  function pickCustomer(c: Customer) {
    setCustId(c.id);
    setCustName(c.name);
    setCustEmail(c.email);
    setCustPhone(c.phone);
    setCustCompany(c.company);
    setCustAddress(c.address);
    setCustOpen(false);
    // Switching to a customer with no payment terms — "leave unpaid" no
    // longer applies to this invoice.
    if (!c.paymentTerms) setLeaveUnpaid(false);
  }

  const custMatches = useMemo(() => {
    const s = custName.trim();
    if (!s || custId) return [];
    return customers
      .filter((c) => matchesSearch(s, [c.name, c.email, c.phone, c.company]))
      .slice(0, 8);
  }, [customers, custName, custId]);

  function onProductPick(rowKey: string, name: string) {
    const match = products.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
    setLines((rows) =>
      rows.map((r) =>
        r.key !== rowKey
          ? r
          : {
              ...r,
              productName: name,
              productId: match?.id ?? null,
              sku: match ? match.sku : r.sku,
              unitPriceCents: match ? match.priceCents : r.unitPriceCents,
            },
      ),
    );
  }

  function onProductSelect(rowKey: string, p: ProductLite) {
    setLines((rows) =>
      rows.map((r) =>
        r.key !== rowKey
          ? r
          : { ...r, productName: p.name, productId: p.id, sku: p.sku, unitPriceCents: p.priceCents },
      ),
    );
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addLine() {
    setLines((rows) => [...rows, blankLine()]);
  }
  function removeLine(key: string) {
    setLines((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
  }

  // Switch a line between $ and % without losing the value — same as the
  // register: carry the current resolved discount across into the other unit.
  function setLineDiscMode(key: string, mode: DiscMode) {
    setLines((rows) =>
      rows.map((r) => {
        if (r.key !== key || r.discMode === mode) return r;
        const base = r.quantity * r.unitPriceCents;
        const cents = resolveLineDiscount(r);
        return mode === "PERCENT"
          ? { ...r, discMode: mode, discPercent: base > 0 ? (cents / base) * 100 : 0 }
          : { ...r, discMode: mode, discountCents: cents };
      }),
    );
  }
  function setLineDiscAmount(key: string, cents: number) {
    updateLine(key, { discMode: "AMOUNT", discountCents: Math.max(0, cents) });
  }
  function setLineDiscPercent(key: string, pct: number) {
    updateLine(key, { discMode: "PERCENT", discPercent: Math.max(0, Math.min(100, pct)) });
  }
  function setLineSerial(key: string, serialNumber: string) {
    updateLine(key, { serialNumber });
  }

  const itemsSubtotalCents = lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
  const lineDiscountsCents = lines.reduce((s, l) => s + resolveLineDiscount(l), 0);
  const netBeforeTaxCents = Math.max(
    0,
    itemsSubtotalCents - lineDiscountsCents - orderDiscountCents + shippingCents,
  );
  const validLines = lines.filter((l) => l.productId && l.quantity > 0);
  const hasCustomer = !!custId || custName.trim().length > 0;
  // Same rule as the register: only a customer set up with payment terms can
  // be left unpaid (billed later). Anyone else must have a payment recorded.
  const selectedCustomerTerms = custId ? (customers.find((c) => c.id === custId)?.paymentTerms ?? "") : "";
  const canLeaveUnpaid = !!selectedCustomerTerms;
  // An admin has no store of their own — same as the register, they must
  // pick one here, since it's what the tax rate (and inventory) comes from.
  const storeMissing = isAdmin && stores.length > 0 && !storeId;
  const selectedStore = stores.find((s) => s.id === storeId) ?? null;
  const taxRateBps = isAdmin ? (selectedStore?.taxRateBps ?? null) : myStoreTaxRateBps;
  const estTaxCents = previewTotalCents !== null ? previewTotalCents - netBeforeTaxCents : null;
  const displayTotalCents = previewTotalCents ?? netBeforeTaxCents;
  const dueNowCents = leaveUnpaid ? 0 : Math.max(0, Math.min(amountReceived ?? displayTotalCents, displayTotalCents));

  // Save the draft on every change; drop it once there's nothing worth
  // keeping (a fresh/empty form).
  useEffect(() => {
    if (!draftHydrated.current) return;
    try {
      const hasContent = hasCustomer || lines.some((l) => l.productId);
      if (!hasContent) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      const draft: InvoiceDraft = {
        userId,
        storeId,
        manualNumber,
        manualDate,
        custId,
        custName,
        custEmail,
        custPhone,
        custCompany,
        custAddress,
        lines,
        orderDiscountCents,
        shippingCents,
        leaveUnpaid,
        paymentMethod,
        amountReceived,
        tenderedCents,
        checkNumber,
        paymentNote,
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage full or unavailable — non-fatal */
    }
  }, [
    userId,
    storeId,
    manualNumber,
    manualDate,
    custId,
    custName,
    custEmail,
    custPhone,
    custCompany,
    custAddress,
    lines,
    orderDiscountCents,
    shippingCents,
    leaveUnpaid,
    paymentMethod,
    amountReceived,
    tenderedCents,
    checkNumber,
    paymentNote,
    hasCustomer,
  ]);

  function customerPayload() {
    if (custId) return { customerId: custId };
    if (custName.trim()) {
      return {
        customer: {
          name: custName.trim(),
          email: custEmail.trim(),
          phone: custPhone.trim(),
          company: custCompany.trim(),
          address: custAddress.trim(),
        },
      };
    }
    return {};
  }

  function buildPayload(dryRun: boolean) {
    return {
      dryRun,
      items: validLines.map((l) => ({
        productId: l.productId!,
        quantity: l.quantity,
        discountCents: resolveLineDiscount(l),
        unitPriceCents: l.unitPriceCents,
        ...(l.serialNumber.trim() ? { serialNumber: l.serialNumber.trim() } : {}),
      })),
      orderDiscountCents,
      shippingCents,
      ...(isAdmin && storeId ? { storeId } : {}),
      ...(isAdmin && manualNumber.trim() ? { number: parseInt(manualNumber.trim(), 10) } : {}),
      ...(isAdmin && manualDate ? { saleDate: manualDate } : {}),
      ...(paymentNote.trim() ? { note: paymentNote.trim() } : {}),
      // The server requires a payment method up front for any customer who
      // isn't on terms (same rule as the register) — even to just total up a
      // dry run — and, for Check, a check number too (it validates that
      // before ever looking at dryRun). Send whatever's currently picked so
      // totaling/previewing doesn't itself get rejected before the real save
      // (with the real amount/tender) replaces this.
      ...(!leaveUnpaid ? { paymentMethod } : {}),
      ...(!leaveUnpaid && paymentMethod === "CHECK" ? { checkNumber: checkNumber.trim() } : {}),
      ...customerPayload(),
    };
  }

  function paymentPayload(totalCents: number) {
    if (leaveUnpaid) return {};
    const amt = Math.max(0, Math.min(amountReceived ?? totalCents, totalCents));
    if (amt <= 0) return {};
    if (amt >= totalCents) {
      return {
        paymentMethod,
        ...(paymentMethod === "CASH" ? { tenderedCents: Math.max(tenderedCents, amt) } : {}),
        ...(paymentMethod === "CHECK" ? { checkNumber: checkNumber.trim() } : {}),
      };
    }
    return {
      depositCents: amt,
      depositMethod: paymentMethod,
      ...(paymentMethod === "CASH" ? { tenderedCents: Math.max(tenderedCents, amt) } : {}),
      ...(paymentMethod === "CHECK" ? { checkNumber: checkNumber.trim() } : {}),
    };
  }

  // Live total/tax preview — recalculated server-side (so tax-exempt
  // customers, rounding, etc. all match exactly) a moment after each edit.
  useEffect(() => {
    if (validLines.length === 0 || !hasCustomer) {
      setPreviewTotalCents(null);
      setPreviewError(null);
      return;
    }
    if (storeMissing) {
      setPreviewTotalCents(null);
      setPreviewError("Choose a store above — tax is charged at that store's rate.");
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api<{ ok: true; totalCents: number }>("/api/sales", {
          method: "POST",
          body: JSON.stringify(buildPayload(true)),
        });
        setPreviewTotalCents(res.totalCents);
        setPreviewError(null);
      } catch (e) {
        setPreviewTotalCents(null);
        setPreviewError(e instanceof ApiError ? e.message : "Could not calculate totals");
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    lines,
    orderDiscountCents,
    shippingCents,
    custId,
    custName,
    storeId,
    manualDate,
    manualNumber,
    leaveUnpaid,
    paymentMethod,
    checkNumber,
  ]);

  async function doSave(): Promise<{ id: string; number: number } | null> {
    setError(null);
    if (storeMissing) {
      setError("Choose a store before saving — it sets the tax rate (same as the register).");
      return null;
    }
    if (!hasCustomer) {
      setError("Add a customer before saving.");
      return null;
    }
    if (leaveUnpaid && !canLeaveUnpaid) {
      setError("This customer isn't set up with payment terms — record a payment instead.");
      return null;
    }
    if (validLines.length === 0) {
      setError("Add at least one product.");
      return null;
    }
    if (
      !leaveUnpaid &&
      paymentMethod === "CHECK" &&
      !checkNumber.trim() &&
      (amountReceived ?? 1) > 0
    ) {
      setError("Enter the check number.");
      return null;
    }
    setSaving(true);
    try {
      const dry = await api<{ ok: true; totalCents: number }>("/api/sales", {
        method: "POST",
        body: JSON.stringify(buildPayload(true)),
      });
      const payload = { ...buildPayload(false), ...paymentPayload(dry.totalCents) };
      const res = await api<{ sale: Sale }>("/api/sales", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const saved = { id: res.sale.id, number: res.sale.number };
      setSavedSale(saved);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      return saved;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the invoice");
      return null;
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setLines([blankLine()]);
    setCustId(null);
    setCustName("");
    setCustEmail("");
    setCustPhone("");
    setCustCompany("");
    setCustAddress("");
    setOrderDiscountCents(0);
    setShippingCents(0);
    setLeaveUnpaid(false);
    setPaymentMethod("CASH");
    setAmountReceived(null);
    setTenderedCents(0);
    setCheckNumber("");
    setManualNumber("");
    setManualDate("");
    setPaymentNote("");
    setPreviewTotalCents(null);
    setPreviewError(null);
    setSavedSale(null);
    setError(null);
  }

  async function handleSaveAndClose() {
    const s = await doSave();
    if (s) router.push("/invoices");
  }
  async function handleSaveAndNew() {
    const s = await doSave();
    if (s) resetForm();
  }
  async function handlePrint() {
    const s = savedSale ?? (await doSave());
    if (s) setPrintOpen(true);
  }
  async function handleSaveAndSend() {
    const s = savedSale ?? (await doSave());
    if (s) {
      alert(
        `Invoice #${s.number} saved. (Email delivery isn't configured yet — use Print or ` +
          `download to send it to the customer yourself.)`,
      );
    }
  }

  if (loading) {
    return <div className="w-full flex-1 p-4 text-sm text-zinc-400">Loading…</div>;
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 p-4 pb-28">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {savedSale ? `Invoice #${savedSale.number}` : "Create invoice"}
        </h1>
        <button onClick={() => router.push("/invoices")} className="btn-ghost text-sm">
          ← Back to invoices
        </button>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {savedSale && (
        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          ✓ Saved. This invoice&rsquo;s items are locked in — print it, send it, or start a new
          one below.
        </p>
      )}

      <fieldset disabled={!!savedSale} className="contents">
        {isAdmin && (
          <section className="card mb-4 p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-700">
              Manual entry <span className="text-xs font-normal text-zinc-400">(admin only)</span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Invoice #</label>
                <input
                  className="input"
                  inputMode="numeric"
                  placeholder="auto"
                  value={manualNumber}
                  onChange={(e) => setManualNumber(e.target.value.replace(/[^0-9]/g, ""))}
                />
              </div>
              <div>
                <label className="label">Invoice date</label>
                <input
                  type="date"
                  className="input"
                  placeholder={todayInputValue()}
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                />
              </div>
              {stores.length > 0 && (
                <div>
                  <label className="label">
                    Store <span className="text-red-500">*</span>
                  </label>
                  <select
                    className={`input ${storeMissing ? "border-amber-400" : ""}`}
                    value={storeId}
                    onChange={(e) => setStoreId(e.target.value)}
                  >
                    <option value="">Choose a store…</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — tax {(s.taxRateBps / 100).toFixed(2)}%
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-400">
              Leave invoice # / date blank to auto-number it and date it today. Set both when
              entering a historical invoice under its real number.
            </p>
            {storeMissing && (
              <p className="mt-1.5 text-xs font-medium text-amber-700">
                Choose a store above — same as the register, that&rsquo;s what sets the tax rate
                (and which inventory this invoice draws from).
              </p>
            )}
          </section>
        )}

        <section className="card mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">Customer</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="relative sm:col-span-2">
              <label className="label">Name *</label>
              <input
                ref={custInputRef}
                className="input"
                value={custName}
                onChange={(e) => {
                  setCustName(e.target.value);
                  setCustId(null);
                  setLeaveUnpaid(false);
                  setCustOpen(true);
                }}
                onFocus={() => setCustOpen(true)}
                onBlur={() => setTimeout(() => setCustOpen(false), 150)}
                placeholder="Type to search, or enter a new customer's name"
              />
              {custOpen && custMatches.length > 0 && (
                <ul className="absolute z-40 mt-1 max-h-56 w-full overflow-auto rounded-md border border-zinc-200 bg-white text-sm shadow-lg">
                  {custMatches.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickCustomer(c);
                        }}
                        className="block w-full px-3 py-1.5 text-left hover:bg-indigo-50"
                      >
                        <span className="font-medium">{c.name}</span>
                        {c.company && <span className="ml-2 text-xs text-zinc-400">{c.company}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <label className="label">Company</label>
              <input
                className="input"
                value={custCompany}
                onChange={(e) => setCustCompany(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={custEmail}
                onChange={(e) => setCustEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={custPhone} onChange={(e) => setCustPhone(e.target.value)} />
            </div>
            <div>
              <label className="label">Address</label>
              <input
                className="input"
                value={custAddress}
                onChange={(e) => setCustAddress(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="card mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">Items</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="py-1.5">Product</th>
                  <th className="w-24 py-1.5">SKU</th>
                  <th className="w-20 py-1.5 text-right">Qty</th>
                  <th className="w-28 py-1.5 text-right">Price</th>
                  <th className="w-40 py-1.5 text-right">Discount</th>
                  <th className="w-28 py-1.5 text-right">Amount</th>
                  <th className="w-8 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((row) => {
                  const lineDisc = resolveLineDiscount(row);
                  const amount = Math.max(0, row.quantity * row.unitPriceCents - lineDisc);
                  return (
                    <tr key={row.key} className="border-t border-zinc-100 align-top">
                      <td className="py-1 pr-2">
                        <ProductPicker
                          value={row.productName}
                          products={products}
                          onText={(t) => onProductPick(row.key, t)}
                          onSelect={(p) => onProductSelect(row.key, p)}
                          onAddNew={() => setQuickAddRowKey(row.key)}
                        />
                        <input
                          className="input mt-1 h-7 w-full text-xs"
                          placeholder="Serial # (optional)"
                          value={row.serialNumber}
                          onChange={(e) => setLineSerial(row.key, e.target.value)}
                        />
                      </td>
                      <td className="py-1 pr-2 text-zinc-500">{row.sku}</td>
                      <td className="py-1 pr-2">
                        <input
                          className="input h-8 text-right"
                          inputMode="numeric"
                          value={row.quantity || ""}
                          onChange={(e) =>
                            updateLine(row.key, {
                              quantity: parseInt(e.target.value.replace(/[^0-9]/g, ""), 10) || 0,
                            })
                          }
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <MoneyInput
                          cents={row.unitPriceCents}
                          onCentsChange={(c) => updateLine(row.key, { unitPriceCents: c })}
                          className="input h-8 text-right"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <div className="flex items-center justify-end gap-1">
                          <div className="flex shrink-0 overflow-hidden rounded-md border border-zinc-300 text-xs">
                            <button
                              type="button"
                              onClick={() => setLineDiscMode(row.key, "AMOUNT")}
                              className={`px-1.5 py-1 ${row.discMode === "AMOUNT" ? "bg-indigo-600 text-white" : "text-zinc-500"}`}
                            >
                              $
                            </button>
                            <button
                              type="button"
                              onClick={() => setLineDiscMode(row.key, "PERCENT")}
                              className={`px-1.5 py-1 ${row.discMode === "PERCENT" ? "bg-indigo-600 text-white" : "text-zinc-500"}`}
                            >
                              %
                            </button>
                          </div>
                          {row.discMode === "PERCENT" ? (
                            <PercentInput
                              value={row.discPercent}
                              onValueChange={(n) => setLineDiscPercent(row.key, n)}
                              className="input h-8 w-16 text-right"
                              aria-label="Discount percent"
                            />
                          ) : (
                            <MoneyInput
                              cents={lineDisc}
                              onCentsChange={(c) => setLineDiscAmount(row.key, c)}
                              className="input h-8 w-20 text-right"
                            />
                          )}
                        </div>
                      </td>
                      <td className="py-1 pr-2 text-right font-medium tabular-nums">
                        {formatMoney(amount)}
                      </td>
                      <td className="py-1 text-right">
                        {lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeLine(row.key)}
                            className="btn-ghost h-8 px-2 text-xs text-red-500"
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={addLine} className="btn-secondary mt-2 h-8 text-xs">
            + Add line
          </button>
        </section>

        <section className="card mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">Discounts, shipping &amp; tax</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label">Order discount</label>
              <MoneyInput
                cents={orderDiscountCents}
                onCentsChange={(c) => setOrderDiscountCents(Math.max(0, c))}
              />
            </div>
            <div>
              <label className="label">Shipping</label>
              <MoneyInput cents={shippingCents} onCentsChange={(c) => setShippingCents(Math.max(0, c))} />
            </div>
          </div>
          <div className="mt-4 space-y-1 border-t border-zinc-100 pt-3 text-sm">
            <Row label="Items" value={formatMoney(itemsSubtotalCents)} />
            {lineDiscountsCents > 0 && (
              <Row label="Line discounts" value={`− ${formatMoney(lineDiscountsCents)}`} />
            )}
            {orderDiscountCents > 0 && (
              <Row label="Order discount" value={`− ${formatMoney(orderDiscountCents)}`} />
            )}
            {shippingCents > 0 && <Row label="Shipping" value={formatMoney(shippingCents)} />}
            <Row
              label={`Tax${taxRateBps != null ? ` (${(taxRateBps / 100).toFixed(2)}%)` : ""}`}
              value={estTaxCents !== null ? formatMoney(Math.max(0, estTaxCents)) : "—"}
            />
            {!isAdmin && myStoreName && (
              <p className="text-[11px] text-zinc-400">
                Selling from {myStoreName}
                {myStoreTaxRateBps != null ? ` (tax ${(myStoreTaxRateBps / 100).toFixed(2)}%)` : ""}.
              </p>
            )}
            {previewError && (
              <p className={`text-xs ${storeMissing ? "font-medium text-amber-700" : "text-red-600"}`}>
                {previewError}
              </p>
            )}
            <Row
              label="Total"
              value={formatMoney(displayTotalCents)}
              bold
            />
          </div>
        </section>

        <section className="card mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">Payment</h2>
          <label
            className={`mb-1 flex items-center gap-2 text-sm ${canLeaveUnpaid ? "" : "text-zinc-400"}`}
          >
            <input
              type="checkbox"
              checked={leaveUnpaid}
              disabled={!canLeaveUnpaid}
              onChange={(e) => setLeaveUnpaid(e.target.checked)}
            />
            Leave unpaid (invoice the customer — they owe the balance)
          </label>
          {!canLeaveUnpaid && (
            <p className="mb-3 text-[11px] text-zinc-400">
              Only available for a customer set up with payment terms (set that on the Customers
              page) — everyone else needs a payment recorded now.
            </p>
          )}
          {!leaveUnpaid && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Method</label>
                <PaymentMethodSelect
                  value={paymentMethod}
                  onChange={setPaymentMethod}
                  methods={paymentMethods}
                  onAdded={(m) => setPaymentMethods((cur) => [...cur, m])}
                />
              </div>
              <div>
                <label className="label">Amount received</label>
                <MoneyInput
                  cents={amountReceived ?? displayTotalCents}
                  onCentsChange={(c) => setAmountReceived(Math.max(0, c))}
                />
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  Less than the total leaves a balance due (a deposit).
                </p>
              </div>
              {paymentMethod === "CASH" && (
                <div>
                  <label className="label">Cash tendered</label>
                  <MoneyInput cents={tenderedCents} onCentsChange={setTenderedCents} />
                </div>
              )}
              {paymentMethod === "CHECK" && (
                <div>
                  <label className="label">Check #</label>
                  <input
                    className="input"
                    value={checkNumber}
                    onChange={(e) => setCheckNumber(e.target.value)}
                  />
                </div>
              )}
              {paymentMethod === "CARD" && (
                <div className="sm:col-span-3">
                  <label className="label">Reference / confirmation # (optional)</label>
                  <input
                    className="input"
                    placeholder="e.g. charged on the website, order #12345"
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                  />
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    This form doesn&rsquo;t run a card itself — choosing Card just records that the
                    customer paid by card (e.g. already charged on the website or a standalone
                    terminal). Note what it refers to here.
                  </p>
                </div>
              )}
            </div>
          )}
          {!leaveUnpaid && (
            <p className="mt-2 text-sm text-zinc-500">
              Due now: <span className="font-medium text-zinc-800">{formatMoney(dueNowCents)}</span>
            </p>
          )}
        </section>
      </fieldset>

      <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2">
          {!savedSale ? (
            <>
              <button onClick={doSave} disabled={saving || storeMissing} className="btn-secondary">
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={handleSaveAndClose}
                disabled={saving || storeMissing}
                className="btn-secondary"
              >
                Save and close
              </button>
              <button
                onClick={handleSaveAndNew}
                disabled={saving || storeMissing}
                className="btn-secondary"
              >
                Save and new
              </button>
              <button onClick={handlePrint} disabled={saving || storeMissing} className="btn-secondary">
                Print or download
              </button>
              <button
                onClick={handleSaveAndSend}
                disabled={saving || storeMissing}
                className="btn-primary ml-auto"
              >
                Save and send
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setPrintOpen(true)} className="btn-secondary">
                Print or download
              </button>
              <button onClick={handleSaveAndSend} className="btn-secondary">
                Send
              </button>
              <button onClick={resetForm} className="btn-secondary">
                + Start a new invoice
              </button>
              <button onClick={() => router.push("/invoices")} className="btn-primary ml-auto">
                Back to invoices
              </button>
            </>
          )}
        </div>
      </div>

      {quickAddRowKey &&
        (() => {
          const rowKey = quickAddRowKey;
          return (
            <QuickAddProductModal
              initialName={lines.find((r) => r.key === rowKey)?.productName ?? ""}
              categories={categories}
              isAdmin={isAdmin}
              onClose={() => setQuickAddRowKey(null)}
              onCreated={(product: Product) => {
                const lite: ProductLite = {
                  id: product.id,
                  name: product.name,
                  sku: product.sku,
                  priceCents: product.priceCents,
                  description: product.description ?? null,
                  vendor: product.vendor ?? "",
                };
                setProducts((cur) => [...cur, lite]);
                onProductSelect(rowKey, lite);
                setQuickAddRowKey(null);
              }}
            />
          );
        })()}

      {printOpen && savedSale && (
        <ReceiptModal saleId={savedSale.id} onClose={() => setPrintOpen(false)} />
      )}
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between ${
        bold ? "border-t border-zinc-200 pt-1.5 font-semibold" : "text-zinc-500"
      }`}
    >
      <span>{label}</span>
      <span className={bold ? "text-zinc-900" : ""}>{value}</span>
    </div>
  );
}

// Free-typed text matches an exact product name if there is one; otherwise an
// "Add new product" option offers to create it (with the usual vendor/
// category quick-add) without leaving the page.
function ProductPicker({
  value,
  products,
  onText,
  onSelect,
  onAddNew,
}: {
  value: string;
  products: ProductLite[];
  onText: (text: string) => void;
  onSelect: (p: ProductLite) => void;
  onAddNew?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const terms = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return products
      .filter((p) => {
        const hay = `${p.name} ${p.sku}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, 30);
  }, [products, value]);

  const exactMatch = products.some((p) => p.name.toLowerCase() === value.trim().toLowerCase());
  const showAddNew = !!onAddNew && !!value.trim() && !exactMatch;

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 2, width: r.width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        !inputRef.current?.contains(e.target as Node) &&
        !boxRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <>
      <input
        ref={inputRef}
        className="input h-8"
        placeholder="Name or SKU"
        value={value}
        onChange={(e) => {
          onText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && rect && (matches.length > 0 || showAddNew) && (
        <div
          ref={boxRef}
          className="fixed z-50 max-h-64 overflow-auto rounded-md border border-zinc-200 bg-white text-sm shadow-lg"
          style={{ left: rect.left, top: rect.top, width: Math.max(rect.width, 280) }}
        >
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              className="block w-full px-3 py-1.5 text-left hover:bg-indigo-50"
              onClick={() => {
                onSelect(p);
                setOpen(false);
              }}
            >
              <span className="font-medium">{p.name}</span>
              <span className="ml-2 text-xs text-zinc-400">{p.sku}</span>
            </button>
          ))}
          {showAddNew && (
            <button
              type="button"
              onClick={() => {
                onAddNew?.();
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left font-medium text-indigo-600 hover:bg-indigo-50 ${
                matches.length > 0 ? "border-t border-zinc-100" : ""
              }`}
            >
              {`+ Add “${value.trim()}” as a new product`}
            </button>
          )}
        </div>
      )}
    </>
  );
}
