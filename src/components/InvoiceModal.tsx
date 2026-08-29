"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney, formatBps } from "@/lib/money";
import type { InvoiceDetail, PurchaseOrder, Vendor } from "@/lib/types";

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
}: {
  saleId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [busyVendor, setBusyVendor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pickerVendor, setPickerVendor] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  // vendor name -> free-freight minimum (cents); 0 / missing means none.
  const [freightMins, setFreightMins] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      setDetail(await api<InvoiceDetail>(`/api/sales/${saleId}`));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load invoice");
    }
  }, [saleId]);

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
                  {new Date(sale.createdAt).toLocaleString()} · {sale.cashier?.name ?? "—"} ·{" "}
                  {sale.paymentMethod}
                  {sale.storeNameSnapshot ? ` · ${sale.storeNameSnapshot}` : ""}
                </p>
                {sale.customerNameSnapshot ? (
                  <p className="mt-1 text-sm">
                    <span className="text-zinc-400">Bill to </span>
                    <span className="font-medium">{sale.customerNameSnapshot}</span>
                    {sale.customerEmailSnapshot ? (
                      <span className="text-zinc-400"> · {sale.customerEmailSnapshot}</span>
                    ) : null}
                    {sale.customerPhoneSnapshot ? (
                      <span className="text-zinc-400"> · {sale.customerPhoneSnapshot}</span>
                    ) : null}
                  </p>
                ) : null}
              </div>
              <button onClick={onClose} className="btn-ghost px-2 py-1 text-sm">
                ✕
              </button>
            </div>

            {err && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

            <table className="w-full text-sm">
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
                              className="input h-7 w-32 text-xs"
                            >
                              {PO_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => deletePo(po.id)}
                              className="btn-ghost px-2 py-0.5 text-xs text-red-500"
                            >
                              Delete
                            </button>
                          </div>
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
    </div>
  );
}
