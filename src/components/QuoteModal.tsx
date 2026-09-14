"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { formatMoney, formatBps } from "@/lib/money";
import { InvoiceModal } from "@/components/InvoiceModal";
import { QuoteReceiptModal } from "@/components/QuoteReceiptModal";
import { QuoteStatusPill } from "@/components/QuoteStatusPill";
import { MoneyInput } from "@/components/MoneyInput";
import { phoneDigits, formatPhone } from "@/lib/phone";
import type { Customer, QuoteDetail } from "@/lib/types";

type ProductLite = { id: string; name: string; sku: string; priceCents: number };
type EditLine = {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
};

/**
 * Shows one quote and its status actions. Approve/reject are recorded here;
 * converting a quote hands off to the register, which builds the cart from
 * it and marks the quote CONVERTED once the resulting sale is saved.
 */
export function QuoteModal({
  quoteId,
  onClose,
  onChanged,
  canManage = true,
  isAdmin = false,
}: {
  quoteId: string;
  onClose: () => void;
  onChanged?: () => void;
  canManage?: boolean;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewSaleId, setViewSaleId] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  // Editing the quote's note / line items (swap a product, change qty/price).
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editNote, setEditNote] = useState("");
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [editItems, setEditItems] = useState<EditLine[]>([]);
  const [itemsTouched, setItemsTouched] = useState(false);
  const [itemMenuIdx, setItemMenuIdx] = useState<number | null>(null);

  // Bill-to editing: search an existing customer, or type a new one.
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [custId, setCustId] = useState<string | null>(null);
  const [custName, setCustName] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custAddress, setCustAddress] = useState("");
  const [custCompany, setCustCompany] = useState("");
  const [custLocationId, setCustLocationId] = useState("");
  const [custOpen, setCustOpen] = useState(false);
  const [custMenuOpen, setCustMenuOpen] = useState(false);
  const [custTouched, setCustTouched] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api<QuoteDetail>(`/api/quotes/${quoteId}`));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load quote");
    }
  }, [quoteId]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(status: "OPEN" | "APPROVED" | "REJECTED") {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/quotes/${quoteId}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not update the quote");
    } finally {
      setBusy(false);
    }
  }

  function convertToInvoice() {
    onClose();
    router.push(`/?fromQuote=${quoteId}`);
  }

  async function deleteQuote() {
    if (!confirm(`Delete quote Q-${detail?.quote.number}? This can't be undone.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/quotes/${quoteId}`, { method: "DELETE" });
      onChanged?.();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete the quote");
    } finally {
      setBusy(false);
    }
  }

  function openEdit() {
    if (!detail) return;
    const q = detail.quote;
    setEditNote(q.note ?? "");
    setEditItems(
      q.items.map((it) => ({
        productId: it.productId,
        name: it.nameSnapshot,
        sku: it.skuSnapshot,
        quantity: it.quantity,
        unitPriceCents: it.unitPriceCents,
        discountCents: it.discountCents,
      })),
    );
    setItemsTouched(false);
    setItemMenuIdx(null);
    if (products.length === 0) {
      api<{ products: ProductLite[] }>("/api/products?take=5000")
        .then((r) => setProducts(r.products))
        .catch(() => {});
    }

    // Seed the bill-to from the quote's current snapshot.
    setCustId(q.customerId ?? null);
    setCustName(q.customerNameSnapshot ?? "");
    setCustEmail(q.customerEmailSnapshot ?? "");
    setCustPhone(formatPhone(q.customerPhoneSnapshot ?? ""));
    setCustAddress(q.customerAddressSnapshot ?? "");
    setCustCompany(q.customerCompanySnapshot ?? "");
    setCustLocationId(""); // resolved once the directory loads, below
    setCustOpen(false);
    setCustMenuOpen(false);
    setCustTouched(false);
    if (customers.length === 0) {
      api<{ customers: Customer[] }>("/api/customers")
        .then((r) => setCustomers(r.customers))
        .catch(() => {});
    }

    setEditOpen(true);
  }

  // Once the directory is in, resolve the quote's saved location label back
  // to a location id so the select shows the right one.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!editOpen || !detail || custTouched || !custId || customers.length === 0) return;
    const label = detail.quote.customerLocationSnapshot;
    const c = customers.find((x) => x.id === custId);
    if (!label || !c?.locations?.length) return;
    const loc = c.locations.find((l) => l.label === label);
    setCustLocationId(loc?.id ?? "MAIN");
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOpen, customers, custId]);

  function pickCustomer(name: string) {
    setCustTouched(true);
    setCustName(name);
    setCustLocationId("");
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

  const custMatches = (() => {
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
  })();

  function selectCustomer(c: Customer) {
    setCustTouched(true);
    setCustName(c.name);
    setCustId(c.id);
    setCustEmail(c.email);
    setCustPhone(formatPhone(c.phone));
    setCustAddress(c.address);
    setCustCompany(c.company);
    setCustLocationId("");
    setCustMenuOpen(false);
  }

  function pickLocation(locId: string) {
    setCustTouched(true);
    setCustLocationId(locId);
    const c = customers.find((x) => x.id === custId);
    const loc = c?.locations?.find((l) => l.id === locId);
    if (loc) {
      if (loc.address) setCustAddress(loc.address);
      if (loc.phone) setCustPhone(formatPhone(loc.phone));
      if (loc.email) setCustEmail(loc.email);
    } else if (c) {
      setCustAddress(c.address);
      setCustPhone(formatPhone(c.phone));
      setCustEmail(c.email);
    }
  }

  function clearCustomer() {
    setCustTouched(true);
    setCustId(null);
    setCustName("");
    setCustEmail("");
    setCustPhone("");
    setCustAddress("");
    setCustCompany("");
    setCustLocationId("");
    setCustOpen(false);
  }

  const selectedCustomer = custId ? (customers.find((c) => c.id === custId) ?? null) : null;

  function itemMatches(text: string): ProductLite[] {
    const terms = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return products
      .filter((p) => {
        const hay = `${p.name} ${p.sku}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, 30);
  }

  function updateItemText(idx: number, text: string) {
    setItemsTouched(true);
    setEditItems((cur) => cur.map((l, i) => (i === idx ? { ...l, name: text, productId: "" } : l)));
  }

  function replaceItemProduct(idx: number, p: ProductLite) {
    setItemsTouched(true);
    setEditItems((cur) =>
      cur.map((l, i) =>
        i === idx ? { ...l, productId: p.id, name: p.name, sku: p.sku, unitPriceCents: p.priceCents } : l,
      ),
    );
    setItemMenuIdx(null);
  }

  function setItemField<K extends "quantity" | "unitPriceCents">(
    idx: number,
    field: K,
    value: EditLine[K],
  ) {
    setItemsTouched(true);
    setEditItems((cur) => cur.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  }

  function removeItem(idx: number) {
    setItemsTouched(true);
    setEditItems((cur) => cur.filter((_, i) => i !== idx));
  }

  function addBlankItem() {
    setItemsTouched(true);
    setEditItems((cur) => [
      ...cur,
      { productId: "", name: "", sku: "", quantity: 1, unitPriceCents: 0, discountCents: 0 },
    ]);
    setItemMenuIdx(editItems.length);
  }

  async function saveEdit() {
    if (itemsTouched) {
      if (editItems.length === 0) {
        setErr("A quote needs at least one item.");
        return;
      }
      if (editItems.some((l) => !l.productId)) {
        setErr("Pick a product from the list for every item.");
        return;
      }
    }
    setEditBusy(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = { note: editNote };
      if (itemsTouched) {
        payload.items = editItems.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          discountCents: l.discountCents,
        }));
      }
      if (custTouched) {
        if (custId) {
          payload.customerId = custId;
          if (custLocationId && custLocationId !== "MAIN") {
            payload.customerLocationId = custLocationId;
          }
        } else if (custName.trim()) {
          payload.customer = {
            name: custName.trim(),
            email: custEmail.trim(),
            phone: custPhone.trim(),
            address: custAddress.trim(),
            company: custCompany.trim(),
          };
        } else {
          payload.customerId = null;
        }
      }
      await api(`/api/quotes/${quoteId}`, { method: "PATCH", body: JSON.stringify(payload) });
      setEditOpen(false);
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save the quote");
    } finally {
      setEditBusy(false);
    }
  }

  const quote = detail?.quote;
  // A quote may hold products with no cost yet, but it can't become an
  // invoice until every one has a cost (the register would block it anyway).
  const noCostNames = (detail?.products ?? [])
    .filter((p) => (p.costCents ?? 0) <= 0)
    .map((p) => p.name);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {!detail || !quote ? (
          <p className="text-sm text-zinc-500">{err ?? "Loading quote…"}</p>
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">Quote Q-{quote.number}</h2>
                  <QuoteStatusPill status={quote.status} />
                </div>
                <p className="text-sm text-zinc-500">
                  {new Date(quote.createdAt).toLocaleString()}
                  {quote.createdBy ? ` · ${quote.createdBy.name}` : ""}
                  {quote.storeNameSnapshot ? ` · ${quote.storeNameSnapshot}` : ""}
                </p>
                {quote.customerCompanySnapshot || quote.customerNameSnapshot ? (
                  <p className="mt-1 text-sm">
                    <span className="text-zinc-400">For </span>
                    <span className="font-medium">
                      {quote.customerCompanySnapshot || quote.customerNameSnapshot}
                    </span>
                    {quote.customerCompanySnapshot && quote.customerNameSnapshot ? (
                      <span className="text-zinc-400"> · {quote.customerNameSnapshot}</span>
                    ) : null}
                    {quote.customerEmailSnapshot ? (
                      <span className="text-zinc-400"> · {quote.customerEmailSnapshot}</span>
                    ) : null}
                    {quote.customerPhoneSnapshot ? (
                      <span className="text-zinc-400"> · {quote.customerPhoneSnapshot}</span>
                    ) : null}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {canManage && quote.status !== "CONVERTED" && (
                  <button onClick={openEdit} className="btn-ghost px-3 py-1 text-sm">
                    Edit
                  </button>
                )}
                <button
                  onClick={() => setPrinting(true)}
                  className="btn-secondary px-3 py-1 text-sm"
                >
                  Print / Save as PDF
                </button>
                {isAdmin && quote.status !== "CONVERTED" && (
                  <button
                    onClick={deleteQuote}
                    disabled={busy}
                    className="btn-ghost px-3 py-1 text-sm text-red-500"
                  >
                    Delete
                  </button>
                )}
                <button onClick={onClose} className="btn-ghost px-2 py-1 text-sm">
                  ✕
                </button>
              </div>
            </div>

            {err && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

            {editOpen && (
              <div className="mb-4 rounded-md border border-zinc-300 bg-zinc-50 p-3">
                <p className="mb-2 text-sm font-medium">Edit quote</p>

                <p className="mb-1.5 text-xs font-medium text-zinc-500">Customer</p>
                <div className="mb-3 rounded-md border border-zinc-200 bg-white p-2">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      {selectedCustomer ? (
                        <div className="flex h-8 w-full items-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm">
                          <span className="truncate font-medium">
                            {selectedCustomer.company || selectedCustomer.name}
                          </span>
                          {selectedCustomer.company && selectedCustomer.name && (
                            <span className="ml-1.5 truncate text-xs text-zinc-400">
                              · {selectedCustomer.name}
                            </span>
                          )}
                        </div>
                      ) : (
                        <input
                          className="input h-8 w-full"
                          placeholder="Search customer, or type a new one…"
                          value={custName}
                          onChange={(e) => {
                            pickCustomer(e.target.value);
                            setCustMenuOpen(true);
                          }}
                          onFocus={() => setCustMenuOpen(true)}
                          onBlur={() => setTimeout(() => setCustMenuOpen(false), 150)}
                        />
                      )}
                      {custMenuOpen && custMatches.length > 0 && (
                        <ul className="absolute z-40 mt-1 max-h-60 w-full overflow-auto rounded-md border border-zinc-200 bg-white text-sm shadow-lg">
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

                  {!!selectedCustomer?.locations?.length && (
                    <select
                      className="input mt-2 h-8 text-sm"
                      value={custLocationId}
                      onChange={(e) => pickLocation(e.target.value)}
                      aria-label="Ship-to location"
                    >
                      <option value="MAIN">
                        Main — {selectedCustomer.address || "no address on file"}
                      </option>
                      {selectedCustomer.locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.label}
                          {l.address ? ` — ${l.address}` : ""}
                        </option>
                      ))}
                    </select>
                  )}

                  {custOpen && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <input
                        className="input h-8"
                        placeholder="Company"
                        value={custCompany}
                        onChange={(e) => {
                          setCustTouched(true);
                          setCustCompany(e.target.value);
                        }}
                      />
                      <input
                        className="input h-8"
                        placeholder="Email"
                        value={custEmail}
                        onChange={(e) => {
                          setCustTouched(true);
                          setCustEmail(e.target.value);
                        }}
                      />
                      <input
                        className="input h-8"
                        placeholder="Phone"
                        value={custPhone}
                        onChange={(e) => {
                          setCustTouched(true);
                          setCustPhone(e.target.value);
                        }}
                      />
                      <input
                        className="input h-8 sm:col-span-2"
                        placeholder="Address"
                        value={custAddress}
                        onChange={(e) => {
                          setCustTouched(true);
                          setCustAddress(e.target.value);
                        }}
                      />
                    </div>
                  )}
                  {!custId && custName.trim() && (
                    <p className="mt-1 text-[11px] text-zinc-400">
                      New customer — added to Customers when the quote is approved and converted.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  {editItems.map((it, idx) => (
                    <div key={idx} className="rounded-md border border-zinc-200 bg-white p-2">
                      <div className="relative">
                        <input
                          className="input h-8"
                          placeholder="Name or model no."
                          value={it.name}
                          onChange={(e) => updateItemText(idx, e.target.value)}
                          onFocus={() => setItemMenuIdx(idx)}
                          onBlur={() =>
                            setTimeout(
                              () => setItemMenuIdx((cur) => (cur === idx ? null : cur)),
                              150,
                            )
                          }
                        />
                        {itemMenuIdx === idx && itemMatches(it.name).length > 0 && (
                          <ul className="absolute z-40 mt-1 max-h-48 w-full overflow-auto rounded-md border border-zinc-200 bg-white text-sm shadow-lg">
                            {itemMatches(it.name).map((p) => (
                              <li key={p.id}>
                                <button
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    replaceItemProduct(idx, p);
                                  }}
                                  className="block w-full px-3 py-1.5 text-left hover:bg-indigo-50"
                                >
                                  <span className="font-medium">{p.name}</span>
                                  <span className="ml-2 text-xs text-zinc-400">{p.sku}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <input
                          type="number"
                          min={1}
                          className="input h-8 w-16 text-right"
                          value={it.quantity}
                          onChange={(e) =>
                            setItemField(idx, "quantity", Math.max(1, parseInt(e.target.value, 10) || 1))
                          }
                        />
                        <MoneyInput
                          cents={it.unitPriceCents}
                          onCentsChange={(c) => setItemField(idx, "unitPriceCents", c)}
                          className="input h-8 w-24 text-right"
                        />
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="btn-ghost ml-auto h-8 px-2 text-xs text-red-500"
                          title="Remove this item"
                        >
                          ✕
                        </button>
                      </div>
                      {!it.productId && it.name && (
                        <p className="mt-1 text-[11px] text-amber-600">
                          Pick a match from the list above.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addBlankItem} className="btn-ghost mt-2 h-8 text-xs">
                  + Add item
                </button>
                <p className="mt-1 text-[11px] text-zinc-400">
                  No item may go below its minimum resale price. Unlike an invoice, a quote may
                  include a product with no cost on file yet.
                </p>

                <textarea
                  className="input mt-3"
                  rows={2}
                  placeholder="Note (prints on the quote)"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                />

                <div className="mt-2 flex gap-2">
                  <button onClick={() => setEditOpen(false)} className="btn-ghost h-8 text-xs">
                    Cancel
                  </button>
                  <button onClick={saveEdit} disabled={editBusy} className="btn-primary h-8 text-xs">
                    {editBusy ? "Saving…" : "Save"}
                  </button>
                </div>
                {quote.status === "APPROVED" && (
                  <p className="mt-2 text-[11px] text-amber-700">
                    Saving item changes moves this quote back to Open — it&apos;ll need approving
                    again.
                  </p>
                )}
              </div>
            )}

            {quote.note ? (
              <p className="mb-3 whitespace-pre-line rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {quote.note}
              </p>
            ) : null}

            {quote.status === "CONVERTED" ? (
              <div className="mb-4 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800">
                Converted to{" "}
                {quote.convertedSale ? (
                  <button
                    onClick={() => setViewSaleId(quote.convertedSale!.id)}
                    className="font-medium underline"
                  >
                    invoice #{quote.convertedSale.number}
                  </button>
                ) : (
                  "an invoice"
                )}
                .
              </div>
            ) : (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {canManage && quote.status !== "APPROVED" && (
                  <button
                    onClick={() => setStatus("APPROVED")}
                    disabled={busy}
                    className="btn-primary h-8 text-xs"
                  >
                    Approve
                  </button>
                )}
                {canManage && quote.status !== "REJECTED" && (
                  <button
                    onClick={() => setStatus("REJECTED")}
                    disabled={busy}
                    className="btn-secondary h-8 text-xs"
                  >
                    Reject
                  </button>
                )}
                {canManage && quote.status !== "OPEN" && (
                  <button
                    onClick={() => setStatus("OPEN")}
                    disabled={busy}
                    className="btn-ghost h-8 text-xs"
                  >
                    Reopen
                  </button>
                )}
                {quote.status === "APPROVED" && (
                  <button
                    onClick={convertToInvoice}
                    disabled={noCostNames.length > 0}
                    title={
                      noCostNames.length > 0
                        ? `Enter a cost for ${noCostNames.join(", ")} first`
                        : undefined
                    }
                    className="btn-primary ml-auto h-8 text-xs"
                  >
                    Convert to invoice →
                  </button>
                )}
              </div>
            )}

            {quote.status === "APPROVED" && noCostNames.length > 0 && (
              <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                No cost is set for {noCostNames.join(", ")}. Enter it on the product before
                converting this quote to an invoice.
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
                  <tr>
                    <th className="py-1.5">Qty</th>
                    <th className="py-1.5">Item</th>
                    <th className="py-1.5 text-right">Unit</th>
                    <th className="py-1.5 text-right">Line</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {quote.items.map((it) => (
                    <tr key={it.id}>
                      <td className="py-1.5">{it.quantity}</td>
                      <td className="py-1.5">
                        {it.nameSnapshot}
                        <span className="block text-xs text-zinc-400">{it.skuSnapshot}</span>
                      </td>
                      <td className="py-1.5 text-right">{formatMoney(it.unitPriceCents)}</td>
                      <td className="py-1.5 text-right">{formatMoney(it.lineTotalCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="text-sm">
                  <tr>
                    <td colSpan={3} className="py-1 text-right text-zinc-500">
                      Subtotal
                    </td>
                    <td className="py-1 text-right">{formatMoney(quote.subtotalCents)}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="py-1 text-right text-zinc-500">
                      Discount
                    </td>
                    <td className="py-1 text-right">− {formatMoney(quote.discountCents)}</td>
                  </tr>
                  {quote.shippingCents > 0 && (
                    <tr>
                      <td colSpan={3} className="py-1 text-right text-zinc-500">
                        Shipping
                      </td>
                      <td className="py-1 text-right">{formatMoney(quote.shippingCents)}</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={3} className="py-1 text-right text-zinc-500">
                      Tax{quote.taxRateBps ? ` (${formatBps(quote.taxRateBps)} est.)` : ""}
                    </td>
                    <td className="py-1 text-right">{formatMoney(quote.taxCents)}</td>
                  </tr>
                  <tr className="font-bold">
                    <td colSpan={3} className="py-1 text-right">
                      Total
                    </td>
                    <td className="py-1 text-right">{formatMoney(quote.totalCents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Tax is an estimate at the store&rsquo;s current rate — the invoice recalculates it for
              real when the quote is converted.
            </p>
          </>
        )}
      </div>

      {viewSaleId && (
        <InvoiceModal
          saleId={viewSaleId}
          onClose={() => setViewSaleId(null)}
          canManage={canManage}
          isAdmin={isAdmin}
        />
      )}

      {printing && quote && (
        <QuoteReceiptModal quote={quote} onClose={() => setPrinting(false)} />
      )}
    </div>
  );
}
