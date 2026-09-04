"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney, formatBps } from "@/lib/money";
import { formatDateOnly, todayInputValue } from "@/lib/date";
import { MoneyInput } from "@/components/MoneyInput";
import { ReceiptModal } from "@/components/ReceiptModal";
import { RefundReceiptModal } from "@/components/RefundReceiptModal";
import type { InvoiceDetail, PurchaseOrder, Sale, Vendor } from "@/lib/types";

type Person = { id: string; name: string };
type ProductLite = { id: string; name: string; sku: string; priceCents: number };
type EditLine = {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  serialNumber: string;
};

const PO_STATUSES: PurchaseOrder["status"][] = ["OPEN", "SENT", "RECEIVED", "CANCELLED"];

type Pick = {
  name: string;
  sku: string;
  max: number;
  qty: number;
  checked: boolean;
  unitCostCents: number;
};

/**
 * Shows one invoice (a completed sale) and lets a manager raise a purchase
 * order per vendor, choosing which line items and quantities go on it.
 * `onChanged` fires whenever a PO is created / updated / deleted here.
 */
export function InvoiceModal({
  saleId,
  onClose,
  onChanged,
  canManage = true,
  isAdmin = false,
}: {
  saleId: string;
  onClose: () => void;
  onChanged?: () => void;
  canManage?: boolean;
  isAdmin?: boolean;
}) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [busyVendor, setBusyVendor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pickerVendor, setPickerVendor] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [printing, setPrinting] = useState(false);
  // vendor name -> free-freight minimum (cents); 0 / missing means none.
  const [freightMins, setFreightMins] = useState<Record<string, number>>({});

  // Recording a payment (deposit / partial / final) against an open invoice.
  const [payMethod, setPayMethod] = useState<"CASH" | "CARD" | "CHECK" | "CREDIT">("CASH");
  const [payCheckNo, setPayCheckNo] = useState("");
  const [payDate, setPayDate] = useState(todayInputValue);
  const [payAmount, setPayAmount] = useState(0);
  const [payBusy, setPayBusy] = useState(false);

  // Editing the invoice's note / bill-to details / salesperson / items (managers).
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [salespeople, setSalespeople] = useState<Person[]>([]);
  const [edit, setEdit] = useState({
    customerCompanySnapshot: "",
    customerNameSnapshot: "",
    customerEmailSnapshot: "",
    customerPhoneSnapshot: "",
    customerAddressSnapshot: "",
    note: "",
    salespersonId: "",
  });
  // Line-item editing: replace a product, change qty/price/serial. Only sent
  // back to the server if actually touched, so a plain note edit doesn't
  // re-trigger cost/UMRP validation or an inventory re-square for nothing.
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [editItems, setEditItems] = useState<EditLine[]>([]);
  const [itemsTouched, setItemsTouched] = useState(false);
  const [itemMenuIdx, setItemMenuIdx] = useState<number | null>(null);

  function openEdit() {
    if (!detail) return;
    const s = detail.sale;
    setEdit({
      customerCompanySnapshot: s.customerCompanySnapshot ?? "",
      customerNameSnapshot: s.customerNameSnapshot ?? "",
      customerEmailSnapshot: s.customerEmailSnapshot ?? "",
      customerPhoneSnapshot: s.customerPhoneSnapshot ?? "",
      customerAddressSnapshot: s.customerAddressSnapshot ?? "",
      note: s.note ?? "",
      salespersonId: s.salesperson?.id ?? s.salespersonId ?? "",
    });
    setEditItems(
      s.items.map((it) => ({
        productId: it.productId,
        name: it.nameSnapshot,
        sku: it.skuSnapshot,
        quantity: it.quantity,
        unitPriceCents: it.unitPriceCents,
        discountCents: it.discountCents,
        serialNumber: it.serialNumber ?? "",
      })),
    );
    setItemsTouched(false);
    setItemMenuIdx(null);
    if (salespeople.length === 0) {
      api<{ people: Person[] }>("/api/salespeople")
        .then((r) => setSalespeople(r.people))
        .catch(() => {});
    }
    if (products.length === 0) {
      api<{ products: ProductLite[] }>("/api/products?take=5000")
        .then((r) => setProducts(r.products))
        .catch(() => {});
    }
    setEditOpen(true);
  }

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
    setEditItems((cur) =>
      cur.map((l, i) => (i === idx ? { ...l, name: text, productId: "" } : l)),
    );
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

  function setItemField<K extends "quantity" | "unitPriceCents" | "serialNumber">(
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
      { productId: "", name: "", sku: "", quantity: 1, unitPriceCents: 0, discountCents: 0, serialNumber: "" },
    ]);
    setItemMenuIdx(editItems.length);
  }

  async function saveEdit() {
    if (itemsTouched) {
      if (editItems.length === 0) {
        setErr("An invoice needs at least one item.");
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
      const { salespersonId, ...rest } = edit;
      const payload: Record<string, unknown> = salespersonId ? { ...rest, salespersonId } : rest;
      if (itemsTouched) {
        payload.items = editItems.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          discountCents: l.discountCents,
          ...(l.serialNumber.trim() ? { serialNumber: l.serialNumber.trim() } : {}),
        }));
      }
      await api(`/api/sales/${saleId}`, { method: "PATCH", body: JSON.stringify(payload) });
      setEditOpen(false);
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save the invoice");
    } finally {
      setEditBusy(false);
    }
  }

  // Refunding the sale (managers).
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundMethod, setRefundMethod] = useState<"CASH" | "CARD" | "CHECK" | "CREDIT">("CASH");
  const [refundCheckNo, setRefundCheckNo] = useState("");
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundRestock, setRefundRestock] = useState(true);
  const [refundReason, setRefundReason] = useState("");
  const [refundDate, setRefundDate] = useState(todayInputValue);
  const [refundBusy, setRefundBusy] = useState(false);
  // Printable refund slip (opened after issuing a refund, or from the history).
  const [refundSlip, setRefundSlip] = useState<{ sale: Sale; refundId: string } | null>(null);

  async function doRefund() {
    if (!detail) return;
    setRefundBusy(true);
    setErr(null);
    try {
      const res = await api<{ sale: Sale; refundId: string }>(
        `/api/sales/${saleId}/refund`,
        {
          method: "POST",
          body: JSON.stringify({
            method: refundMethod,
            ...(refundMethod === "CHECK" ? { checkNumber: refundCheckNo.trim() } : {}),
            restock: refundRestock,
            reason: refundReason.trim(),
            refundedAt: refundDate,
            ...(refundAmount ? { amountCents: refundAmount } : {}),
          }),
        },
      );
      setRefundOpen(false);
      setRefundAmount(0);
      setRefundReason("");
      setRefundCheckNo("");
      // Pop the printable refund slip straight away.
      setRefundSlip({ sale: res.sale, refundId: res.refundId });
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not refund");
    } finally {
      setRefundBusy(false);
    }
  }

  const load = useCallback(async () => {
    try {
      setDetail(await api<InvoiceDetail>(`/api/sales/${saleId}`));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load invoice");
    }
  }, [saleId]);

  async function recordPayment(amountCents?: number) {
    if (!detail) return;
    setPayBusy(true);
    setErr(null);
    try {
      await api(`/api/sales/${saleId}`, {
        method: "PATCH",
        body: JSON.stringify({
          paymentMethod: payMethod,
          ...(payMethod === "CHECK" ? { checkNumber: payCheckNo.trim() } : {}),
          paidAt: payDate,
          ...(amountCents ? { amountCents } : {}),
        }),
      });
      setPayAmount(0);
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the payment");
    } finally {
      setPayBusy(false);
    }
  }

  useEffect(() => {
    load();
    api<{ vendors: Vendor[] }>("/api/vendors")
      .then((r) =>
        setFreightMins(Object.fromEntries(r.vendors.map((v) => [v.name, v.freightMinimumCents]))),
      )
      .catch(() => {});
  }, [load]);

  function changed() {
    load();
    onChanged?.();
  }

  // This vendor's invoice lines, merged by product.
  function vendorLines(vendor: string) {
    const byProduct = new Map<
      string,
      { productId: string; name: string; sku: string; available: number; unitCostCents: number }
    >();
    for (const it of detail?.sale.items ?? []) {
      if ((it.vendorSnapshot || "") !== vendor) continue;
      const g = byProduct.get(it.productId) ?? {
        productId: it.productId,
        name: it.nameSnapshot,
        sku: it.skuSnapshot,
        available: 0,
        unitCostCents: it.unitCostCents,
      };
      g.available += it.quantity;
      byProduct.set(it.productId, g);
    }
    return [...byProduct.values()];
  }

  function openPicker(vendor: string) {
    setErr(null);
    const next: Record<string, Pick> = {};
    for (const l of vendorLines(vendor)) {
      next[l.productId] = {
        name: l.name,
        sku: l.sku,
        max: l.available,
        qty: l.available,
        checked: true,
        unitCostCents: l.unitCostCents,
      };
    }
    setPicks(next);
    setPickerVendor(vendor);
  }

  async function confirmPo() {
    if (!pickerVendor) return;
    const chosen = Object.entries(picks).filter(([, p]) => p.checked && p.qty > 0);
    const items = chosen.map(([productId, p]) => ({ productId, quantity: p.qty }));
    if (items.length === 0) {
      setErr("Select at least one item.");
      return;
    }

    const min = freightMins[pickerVendor] ?? 0;
    const poCostCents = chosen.reduce((s, [, p]) => s + p.qty * p.unitCostCents, 0);
    if (
      min > 0 &&
      poCostCents < min &&
      !confirm(
        `This purchase order is ${formatMoney(min - poCostCents)} below ${pickerVendor}'s ` +
          `free-freight minimum of ${formatMoney(min)}. Freight charges may apply.\n\n` +
          `Create the purchase order anyway?`,
      )
    ) {
      return;
    }

    setBusyVendor(pickerVendor);
    setErr(null);
    try {
      await api(`/api/sales/${saleId}/purchase-orders`, {
        method: "POST",
        body: JSON.stringify({ vendor: pickerVendor, items }),
      });
      setPickerVendor(null);
      setPicks({});
      changed();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not create purchase order");
    } finally {
      setBusyVendor(null);
    }
  }

  async function setPoStatus(id: string, status: string) {
    try {
      await api(`/api/purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      changed();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not update status");
    }
  }

  async function deletePo(id: string) {
    if (!confirm("Delete this purchase order? You can re-create it afterward.")) return;
    try {
      await api(`/api/purchase-orders/${id}`, { method: "DELETE" });
      changed();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete");
    }
  }

  const sale = detail?.sale;
  const custCreditCents =
    sale?.customer && "storeCreditCents" in sale.customer
      ? sale.customer.storeCreditCents
      : 0;
  const refundedCents = sale?.refundedCents ?? 0;
  const refundableCents = sale ? (sale.amountPaidCents ?? 0) - refundedCents : 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {!detail || !sale ? (
          <p className="text-sm text-zinc-500">{err ?? "Loading invoice…"}</p>
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Invoice #{sale.number}</h2>
                <p className="text-sm text-zinc-500">
                  {new Date(sale.createdAt).toLocaleString()} ·{" "}
                  {sale.salesperson?.name ?? sale.cashier?.name ?? "—"}
                  {sale.salesperson && sale.cashier && sale.salesperson.id !== sale.cashier.id
                    ? ` (rung by ${sale.cashier.name})`
                    : ""}
                  {" · "}
                  {sale.paymentMethod === "CHECK" && sale.checkNumber
                    ? `Check #${sale.checkNumber}`
                    : sale.paymentMethod}
                  {sale.storeNameSnapshot ? ` · ${sale.storeNameSnapshot}` : ""}
                </p>
                {(sale.storeAddressSnapshot || sale.storePhoneSnapshot) && (
                  <p className="text-xs text-zinc-400">
                    {[sale.storeAddressSnapshot, sale.storePhoneSnapshot].filter(Boolean).join(" · ")}
                  </p>
                )}
                {sale.customerCompanySnapshot || sale.customerNameSnapshot ? (
                  <p className="mt-1 text-sm">
                    <span className="text-zinc-400">Bill to </span>
                    <span className="font-medium">
                      {sale.customerCompanySnapshot || sale.customerNameSnapshot}
                    </span>
                    {sale.customerCompanySnapshot && sale.customerNameSnapshot ? (
                      <span className="text-zinc-400"> · {sale.customerNameSnapshot}</span>
                    ) : null}
                    {sale.customerEmailSnapshot ? (
                      <span className="text-zinc-400"> · {sale.customerEmailSnapshot}</span>
                    ) : null}
                    {sale.customerPhoneSnapshot ? (
                      <span className="text-zinc-400"> · {sale.customerPhoneSnapshot}</span>
                    ) : null}
                  </p>
                ) : null}
                {(sale.dueDate || sale.termsSnapshot || sale.customerTaxExemptSnapshot) && (
                  <p className="mt-1 text-sm">
                    {sale.termsSnapshot ? (
                      <span className="text-zinc-400">Terms {sale.termsSnapshot} · </span>
                    ) : null}
                    {sale.dueDate ? (
                      <span className="font-medium">
                        Due {formatDateOnly(sale.dueDate)}
                      </span>
                    ) : null}
                    {sale.customerTaxExemptSnapshot ? (
                      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                        Tax-exempt
                      </span>
                    ) : null}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {canManage && (
                  <button onClick={openEdit} className="btn-ghost px-3 py-1 text-sm">
                    Edit
                  </button>
                )}
                <button
                  onClick={() => setPrinting(true)}
                  className="btn-secondary px-3 py-1 text-sm"
                >
                  Print receipt
                </button>
                {isAdmin && (
                  <button
                    onClick={async () => {
                      if (
                        !confirm(
                          `Delete invoice #${sale.number}? This can't be undone — items go back ` +
                            `into stock and any store credit used is returned.`,
                        )
                      )
                        return;
                      try {
                        await api(`/api/sales/${saleId}`, { method: "DELETE" });
                        onChanged?.();
                        onClose();
                      } catch (e) {
                        setErr(e instanceof ApiError ? e.message : "Could not delete");
                      }
                    }}
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
                <p className="mb-2 text-sm font-medium">Edit invoice</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    className="input h-8"
                    placeholder="Company"
                    value={edit.customerCompanySnapshot}
                    onChange={(e) =>
                      setEdit({ ...edit, customerCompanySnapshot: e.target.value })
                    }
                  />
                  <input
                    className="input h-8"
                    placeholder="Contact name"
                    value={edit.customerNameSnapshot}
                    onChange={(e) => setEdit({ ...edit, customerNameSnapshot: e.target.value })}
                  />
                  <input
                    className="input h-8"
                    placeholder="Email"
                    value={edit.customerEmailSnapshot}
                    onChange={(e) => setEdit({ ...edit, customerEmailSnapshot: e.target.value })}
                  />
                  <input
                    className="input h-8"
                    placeholder="Phone"
                    value={edit.customerPhoneSnapshot}
                    onChange={(e) => setEdit({ ...edit, customerPhoneSnapshot: e.target.value })}
                  />
                  <input
                    className="input h-8 sm:col-span-2"
                    placeholder="Address"
                    value={edit.customerAddressSnapshot}
                    onChange={(e) =>
                      setEdit({ ...edit, customerAddressSnapshot: e.target.value })
                    }
                  />
                  <label className="sm:col-span-2">
                    <span className="mb-1 block text-xs text-zinc-500">Salesperson</span>
                    <select
                      className="input h-8"
                      value={edit.salespersonId}
                      onChange={(e) => setEdit({ ...edit, salespersonId: e.target.value })}
                    >
                      {/* Keep the current person selectable even if they're not
                          in the scoped list (e.g. moved store). */}
                      {edit.salespersonId &&
                        !salespeople.some((p) => p.id === edit.salespersonId) && (
                          <option value={edit.salespersonId}>
                            {detail?.sale.salesperson?.name ?? "Current"}
                          </option>
                        )}
                      {salespeople.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <textarea
                    className="input sm:col-span-2"
                    rows={2}
                    placeholder="Note (prints on the invoice)"
                    value={edit.note}
                    onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                  />
                </div>

                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-medium text-zinc-500">
                    Items — replace a product or change its price/quantity
                  </p>
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
                          <input
                            className="input h-8 flex-1"
                            placeholder="Serial # (optional)"
                            value={it.serialNumber}
                            onChange={(e) => setItemField(idx, "serialNumber", e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            className="btn-ghost h-8 px-2 text-xs text-red-500"
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
                    Same rules as ringing a sale apply — no item may go below its minimum resale
                    price, and every item needs a cost on file.
                  </p>
                </div>

                <div className="mt-2 flex gap-2">
                  <button onClick={() => setEditOpen(false)} className="btn-ghost h-8 text-xs">
                    Cancel
                  </button>
                  <button
                    onClick={saveEdit}
                    disabled={editBusy}
                    className="btn-primary h-8 text-xs"
                  >
                    {editBusy ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}

            {sale.note ? (
              <p className="mb-3 whitespace-pre-line rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {sale.note}
              </p>
            ) : null}

            {(() => {
              const paid = sale.amountPaidCents ?? 0;
              const balance = sale.totalCents - paid;
              const payments = sale.payments ?? [];
              if (sale.status === "INVOICED") {
                return (
                  <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3">
                    <div className="flex flex-wrap items-baseline gap-x-4 text-sm">
                      <span className="font-medium text-amber-800">
                        {paid > 0 ? "Open invoice" : "Unpaid invoice"} —{" "}
                        {formatMoney(balance)} balance
                      </span>
                      <span className="text-amber-700">
                        of {formatMoney(sale.totalCents)}
                        {paid > 0 ? ` · ${formatMoney(paid)} paid` : ""}
                        {sale.dueDate ? ` · due ${formatDateOnly(sale.dueDate)}` : ""}
                        {sale.termsSnapshot ? ` (${sale.termsSnapshot})` : ""}
                      </span>
                    </div>

                    {payments.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs text-amber-800">
                        {payments.map((p) => (
                          <li key={p.id}>
                            {p.isDeposit ? "Deposit" : "Payment"} {formatMoney(p.amountCents)} ·{" "}
                            {p.method === "CHECK" && p.checkNumber
                              ? `Check #${p.checkNumber}`
                              : p.method}{" "}
                            · {formatDateOnly(p.paidAt)}
                          </li>
                        ))}
                      </ul>
                    )}

                    {canManage && (
                      <div className="mt-3 flex flex-wrap items-end gap-3">
                        <div>
                          <label className="label">Method</label>
                          <select
                            className="input h-8"
                            value={payMethod}
                            onChange={(e) =>
                              setPayMethod(
                                e.target.value as "CASH" | "CARD" | "CHECK" | "CREDIT",
                              )
                            }
                          >
                            <option value="CASH">Cash</option>
                            <option value="CARD">Card</option>
                            <option value="CHECK">Check</option>
                            {custCreditCents > 0 && (
                              <option value="CREDIT">
                                Store credit ({formatMoney(custCreditCents)})
                              </option>
                            )}
                          </select>
                        </div>
                        {payMethod === "CHECK" && (
                          <div>
                            <label className="label">Check #</label>
                            <input
                              className="input h-8 w-28"
                              value={payCheckNo}
                              onChange={(e) => setPayCheckNo(e.target.value)}
                              placeholder="1042"
                              inputMode="numeric"
                            />
                          </div>
                        )}
                        <div>
                          <label className="label">Received on</label>
                          <input
                            type="date"
                            className="input h-8"
                            value={payDate}
                            onChange={(e) => setPayDate(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="label">Amount</label>
                          <MoneyInput
                            cents={payAmount}
                            onCentsChange={setPayAmount}
                            className="input h-8 w-28 text-right"
                            placeholder={(balance / 100).toFixed(2)}
                          />
                        </div>
                        <button
                          onClick={() => recordPayment(payAmount || undefined)}
                          disabled={
                            payBusy ||
                            (payAmount > 0 && payAmount > balance) ||
                            (payMethod === "CHECK" && !payCheckNo.trim())
                          }
                          className="btn-primary h-8"
                        >
                          {payBusy
                            ? "Saving…"
                            : payAmount > 0 && payAmount < balance
                              ? `Record ${formatMoney(payAmount)}`
                              : "Pay balance"}
                        </button>
                      </div>
                    )}
                    <p className="mt-1 text-[11px] text-amber-700">
                      Deposits are held; the sale counts as revenue on the day the balance is
                      cleared. Leave Amount blank to pay the whole balance.
                    </p>
                  </div>
                );
              }
              if (sale.paidAt && (payments.length > 0 || sale.termsSnapshot)) {
                return (
                  <div className="mb-3 text-sm text-green-700">
                    Paid in full {formatDateOnly(sale.paidAt)}
                    {payments.length > 0 && (
                      <span className="ml-2 text-xs text-zinc-500">
                        (
                        {payments
                          .map((p) => `${formatMoney(p.amountCents)} ${p.method}`)
                          .join(", ")}
                        )
                      </span>
                    )}
                  </div>
                );
              }
              return null;
            })()}

            {/* Refunds */}
            {(refundedCents > 0 || (canManage && refundableCents > 0)) && (
              <div className="mb-4 rounded-md border border-zinc-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {refundedCents > 0
                      ? `Refunded ${formatMoney(refundedCents)}`
                      : "Refund"}
                    {refundedCents >= sale.totalCents && refundedCents > 0
                      ? " · fully refunded"
                      : ""}
                  </span>
                  {canManage && refundableCents > 0 && !refundOpen && (
                    <button
                      onClick={() => {
                        setRefundAmount(0);
                        setRefundOpen(true);
                      }}
                      className="btn-secondary h-8 text-xs"
                    >
                      Issue refund
                    </button>
                  )}
                </div>

                {(sale.refunds ?? []).length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-zinc-500">
                    {(sale.refunds ?? []).map((r) => (
                      <li key={r.id} className="flex items-center gap-2">
                        <span>
                          {formatMoney(r.amountCents)} →{" "}
                          {r.method === "CHECK" && r.checkNumber
                            ? `Check #${r.checkNumber}`
                            : r.method}{" "}
                          · {formatDateOnly(r.refundedAt)}
                          {r.restocked ? " · items restocked" : ""}
                          {r.reason ? ` · ${r.reason}` : ""}
                        </span>
                        <button
                          onClick={() => setRefundSlip({ sale: sale as Sale, refundId: r.id })}
                          className="btn-ghost shrink-0 px-1.5 py-0.5 text-[11px] text-indigo-600"
                          title="Print the refund slip"
                        >
                          Slip
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {canManage && refundOpen && (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="label">Amount</label>
                        <MoneyInput
                          cents={refundAmount}
                          onCentsChange={setRefundAmount}
                          className="input h-8 w-28 text-right"
                          placeholder={(refundableCents / 100).toFixed(2)}
                        />
                      </div>
                      <div>
                        <label className="label">Refund to</label>
                        <select
                          className="input h-8"
                          value={refundMethod}
                          onChange={(e) =>
                            setRefundMethod(
                              e.target.value as "CASH" | "CARD" | "CHECK" | "CREDIT",
                            )
                          }
                        >
                          <option value="CASH">Cash</option>
                          <option value="CARD">Card</option>
                          <option value="CHECK">Check</option>
                          <option value="CREDIT" disabled={!sale.customerId}>
                            Store credit
                          </option>
                        </select>
                      </div>
                      {refundMethod === "CHECK" && (
                        <div>
                          <label className="label">Check #</label>
                          <input
                            className="input h-8 w-28"
                            value={refundCheckNo}
                            onChange={(e) => setRefundCheckNo(e.target.value)}
                            placeholder="1042"
                            inputMode="numeric"
                          />
                        </div>
                      )}
                      <div>
                        <label className="label">Date</label>
                        <input
                          type="date"
                          className="input h-8"
                          value={refundDate}
                          onChange={(e) => setRefundDate(e.target.value)}
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={refundRestock}
                        onChange={(e) => setRefundRestock(e.target.checked)}
                      />
                      Return the order&rsquo;s items to stock
                    </label>
                    <input
                      className="input h-8"
                      placeholder="Reason (optional)"
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setRefundOpen(false)}
                        className="btn-ghost h-8 text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={doRefund}
                        disabled={
                          refundBusy ||
                          (refundAmount > 0 && refundAmount > refundableCents) ||
                          (refundMethod === "CHECK" && !refundCheckNo.trim())
                        }
                        className="btn-primary h-8 text-xs"
                      >
                        {refundBusy
                          ? "Refunding…"
                          : refundAmount > 0 && refundAmount < refundableCents
                            ? `Refund ${formatMoney(refundAmount)}`
                            : `Refund ${formatMoney(refundableCents)}`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="py-1.5">Qty</th>
                  <th className="py-1.5">Item</th>
                  <th className="py-1.5">Vendor</th>
                  <th className="py-1.5 text-right">Unit</th>
                  <th className="py-1.5 text-right">Line</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sale.items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-1.5">{it.quantity}</td>
                    <td className="py-1.5">
                      {it.nameSnapshot}
                      <span className="block text-xs text-zinc-400">{it.skuSnapshot}</span>
                      {it.serialNumber ? (
                        <span className="block text-xs text-zinc-500">S/N: {it.serialNumber}</span>
                      ) : null}
                    </td>
                    <td className="py-1.5 text-zinc-500">{it.vendorSnapshot || "—"}</td>
                    <td className="py-1.5 text-right">{formatMoney(it.unitPriceCents)}</td>
                    <td className="py-1.5 text-right">{formatMoney(it.lineTotalCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                <tr>
                  <td colSpan={4} className="py-1 text-right text-zinc-500">
                    Subtotal
                  </td>
                  <td className="py-1 text-right">{formatMoney(sale.subtotalCents)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="py-1 text-right text-zinc-500">
                    Discount
                  </td>
                  <td className="py-1 text-right">− {formatMoney(sale.discountCents)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="py-1 text-right text-zinc-500">
                    Tax{sale.taxRateBps ? ` (${formatBps(sale.taxRateBps)})` : ""}
                  </td>
                  <td className="py-1 text-right">{formatMoney(sale.taxCents)}</td>
                </tr>
                <tr className="font-bold">
                  <td colSpan={4} className="py-1 text-right">
                    Total
                  </td>
                  <td className="py-1 text-right">{formatMoney(sale.totalCents)}</td>
                </tr>
              </tfoot>
            </table>
            </div>

            <div className="mt-6">
              <h3 className="mb-2 font-semibold">Purchase orders</h3>

              {detail.vendors.length === 0 && (
                <p className="text-sm text-zinc-400">
                  No vendors on this invoice. Set a vendor on these products to raise a PO.
                </p>
              )}

              <div className="space-y-2">
                {detail.vendors.map((v) => {
                  const po = sale.purchaseOrders.find((p) => p.vendor === v.vendor);
                  const picking = pickerVendor === v.vendor;
                  return (
                    <div key={v.vendor} className="rounded-md border border-zinc-200 text-sm">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                        {po ? (
                          <Link
                            href={`/purchase-orders/${po.id}`}
                            className="font-mono font-semibold text-indigo-600 hover:underline"
                            title="Open this purchase order"
                          >
                            {po.poNumber}
                          </Link>
                        ) : (
                          <span className="font-mono font-semibold">{v.poNumber}</span>
                        )}
                        <span className="font-medium">{v.vendor}</span>
                        <span className="text-zinc-400">
                          {v.quantity} item{v.quantity === 1 ? "" : "s"} · cost{" "}
                          {formatMoney(po?.subtotalCents ?? v.costCents)}
                        </span>

                        {po ? (
                          <div className="ml-auto flex items-center gap-2">
                            <Link
                              href={`/purchase-orders/${po.id}`}
                              className="btn-ghost px-2 py-0.5 text-xs text-indigo-600"
                            >
                              Open
                            </Link>
                            <select
                              value={po.status}
                              onChange={(e) => setPoStatus(po.id, e.target.value)}
                              disabled={!canManage}
                              className="input h-7 w-32 text-xs"
                            >
                              {PO_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                            {canManage && (
                              <button
                                onClick={() => deletePo(po.id)}
                                className="btn-ghost px-2 py-0.5 text-xs text-red-500"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        ) : !canManage ? (
                          <span className="ml-auto text-xs text-zinc-400">No PO yet</span>
                        ) : picking ? (
                          <button
                            onClick={() => setPickerVendor(null)}
                            className="btn-ghost ml-auto h-7 px-2 text-xs"
                          >
                            Cancel
                          </button>
                        ) : (
                          <button
                            onClick={() => openPicker(v.vendor)}
                            className="btn-primary ml-auto h-7 text-xs"
                          >
                            Create PO…
                          </button>
                        )}
                      </div>

                      {!po &&
                        (freightMins[v.vendor] ?? 0) > 0 &&
                        v.costCents < (freightMins[v.vendor] ?? 0) && (
                          <div className="border-t border-amber-100 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
                            {formatMoney((freightMins[v.vendor] ?? 0) - v.costCents)} under this
                            vendor&rsquo;s {formatMoney(freightMins[v.vendor] ?? 0)} free-freight
                            minimum — freight may be charged.
                          </div>
                        )}

                      {picking && !po && (
                        <div className="border-t border-zinc-100 px-3 py-2">
                          <p className="mb-1.5 text-xs text-zinc-400">
                            Choose the items and quantities for PO {v.poNumber}.
                          </p>
                          <ul className="space-y-1.5">
                            {Object.entries(picks).map(([pid, p]) => (
                              <li key={pid} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={p.checked}
                                  onChange={(e) =>
                                    setPicks((cur) => ({
                                      ...cur,
                                      [pid]: { ...cur[pid], checked: e.target.checked },
                                    }))
                                  }
                                />
                                <span className="min-w-0 flex-1 truncate">
                                  {p.name}
                                  <span className="ml-1 text-xs text-zinc-400">{p.sku}</span>
                                </span>
                                <input
                                  type="number"
                                  min={1}
                                  max={p.max}
                                  value={p.qty}
                                  disabled={!p.checked}
                                  onChange={(e) => {
                                    const n = Math.max(1, Math.min(p.max, parseInt(e.target.value, 10) || 1));
                                    setPicks((cur) => ({ ...cur, [pid]: { ...cur[pid], qty: n } }));
                                  }}
                                  className="input h-7 w-16 text-right text-xs"
                                />
                                <span className="w-10 text-right text-xs text-zinc-400">/ {p.max}</span>
                              </li>
                            ))}
                          </ul>
                          <button
                            onClick={confirmPo}
                            disabled={busyVendor === v.vendor}
                            className="btn-primary mt-2 h-7 text-xs"
                          >
                            {busyVendor === v.vendor ? "Creating…" : `Create purchase order ${v.poNumber}`}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {detail.unassignedQty > 0 && (
                <p className="mt-2 text-xs text-amber-600">
                  {detail.unassignedQty} item(s) have no vendor and are not included in any PO.
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {printing && sale && (
        <ReceiptModal sale={sale} onClose={() => setPrinting(false)} />
      )}

      {refundSlip && (
        <RefundReceiptModal
          sale={refundSlip.sale}
          refundId={refundSlip.refundId}
          onClose={() => setRefundSlip(null)}
        />
      )}
    </div>
  );
}
