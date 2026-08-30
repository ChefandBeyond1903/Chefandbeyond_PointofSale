"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { InvoiceModal } from "@/components/InvoiceModal";
import { ReceiveModal } from "@/components/ReceiveModal";
import type { PurchaseOrder, Sale } from "@/lib/types";

const STATUSES = ["ALL", "OPEN", "CLOSED", "SENT", "PARTIAL", "RECEIVED", "CANCELLED"] as const;
type StatusFilter = (typeof STATUSES)[number];

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-amber-100 text-amber-700",
  CLOSED: "bg-zinc-200 text-zinc-600",
  SENT: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-orange-100 text-orange-700",
  RECEIVED: "bg-green-100 text-green-700",
  CANCELLED: "bg-zinc-100 text-zinc-500",
};

export function PurchaseOrdersView({ canManage = true }: { canManage?: boolean }) {
  const router = useRouter();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openSaleId, setOpenSaleId] = useState<string | null>(null);
  const [receiveId, setReceiveId] = useState<string | null>(null);
  const [fromInvoiceOpen, setFromInvoiceOpen] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [resolving, setResolving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = filter === "ALL" ? "" : `?status=${filter}`;
      const res = await api<{ purchaseOrders: PurchaseOrder[] }>(`/api/purchase-orders${qs}`);
      setPos(res.purchaseOrders);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load purchase orders");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function openInvoiceByNumber() {
    const n = parseInt(invoiceNo.trim(), 10);
    if (!Number.isInteger(n) || n <= 0) {
      setError("Enter a valid invoice number.");
      return;
    }
    setResolving(true);
    setError(null);
    try {
      const res = await api<{ sales: Sale[] }>(`/api/sales?number=${n}&take=1`);
      if (res.sales.length === 0) {
        setError(`No invoice #${n} found.`);
        return;
      }
      setOpenSaleId(res.sales[0].id);
      setFromInvoiceOpen(false);
      setInvoiceNo("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Lookup failed");
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="w-full flex-1 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Purchase orders</h1>
        <div className="ml-auto flex gap-1 rounded-md bg-zinc-100 p-1 text-sm">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded px-2.5 py-1 font-medium ${
                filter === s ? "bg-white shadow-sm" : "text-zinc-500"
              }`}
            >
              {s === "ALL" ? "All" : s[0] + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        {canManage && (
          <>
            <button onClick={() => setFromInvoiceOpen((v) => !v)} className="btn-secondary">
              From invoice…
            </button>
            <button onClick={() => router.push("/purchase-orders/new")} className="btn-primary">
              New purchase order
            </button>
          </>
        )}
      </div>

      {fromInvoiceOpen && (
        <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="label">Invoice / ticket number</label>
            <input
              className="input w-40"
              inputMode="numeric"
              placeholder="e.g. 1042"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && openInvoiceByNumber()}
              autoFocus
            />
          </div>
          <button onClick={openInvoiceByNumber} disabled={resolving} className="btn-primary">
            {resolving ? "Opening…" : "Open invoice"}
          </button>
          <p className="text-xs text-zinc-400">
            Raise a PO from a sale — one per vendor, numbered like{" "}
            <span className="font-mono">1042A</span>.
          </p>
        </div>
      )}

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5">PO #</th>
              <th className="px-4 py-2.5">Vendor</th>
              <th className="px-4 py-2.5">Invoice</th>
              <th className="px-4 py-2.5 text-right">Items</th>
              <th className="px-4 py-2.5 text-right">Received</th>
              <th className="px-4 py-2.5 text-right">Cost</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Created</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : pos.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-zinc-400">
                  No purchase orders{filter === "ALL" ? " yet" : ` with status ${filter}`}.
                </td>
              </tr>
            ) : (
              pos.map((po) => (
                <tr
                  key={po.id}
                  onClick={() => router.push(`/purchase-orders/${po.id}`)}
                  className="cursor-pointer hover:bg-zinc-50"
                >
                  <td className="px-4 py-2.5 font-mono font-semibold">{po.poNumber}</td>
                  <td className="px-4 py-2.5">{po.vendor}</td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {po.sale?.number ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenSaleId(po.sale!.id);
                        }}
                        className="text-indigo-600 hover:underline"
                      >
                        #{po.sale.number}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-500">{po._count?.items ?? 0}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-500 tabular-nums">
                    {(() => {
                      const ord = (po.items ?? []).reduce((s, i) => s + i.quantity, 0);
                      const rec = (po.items ?? []).reduce((s, i) => s + i.receivedQuantity, 0);
                      return ord ? `${rec} / ${ord}` : "—";
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatMoney(po.subtotalCents)}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLE[po.status] ?? "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {po.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {new Date(po.createdAt).toLocaleDateString()}
                    {po.createdBy ? ` · ${po.createdBy.name}` : ""}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canManage &&
                      (po.items ?? []).length > 0 &&
                      po.status !== "CANCELLED" &&
                      po.status !== "RECEIVED" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setReceiveId(po.id);
                          }}
                          className="btn-secondary h-7 text-xs"
                        >
                          Receive
                        </button>
                      )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {openSaleId && (
        <InvoiceModal
          saleId={openSaleId}
          onClose={() => setOpenSaleId(null)}
          onChanged={load}
          canManage={canManage}
        />
      )}

      {receiveId && (
        <ReceiveModal
          poId={receiveId}
          onClose={() => setReceiveId(null)}
          onReceived={load}
        />
      )}
    </div>
  );
}
