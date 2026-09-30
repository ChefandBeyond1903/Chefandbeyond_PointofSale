"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { InvoiceModal } from "@/components/InvoiceModal";
import { BillModal } from "@/components/BillModal";
import { usePaged } from "@/lib/usePaged";
import { Pager } from "@/components/Pager";
import { SearchBox } from "@/components/ListToolbar";
import { matchesSearch } from "@/lib/search";
import type { PurchaseOrder, Sale } from "@/lib/types";

const STATUSES = [
  "ALL", "OPEN", "CLOSED", "SENT", "PARTIAL", "RECEIVED", "NOT_RECEIVED", "CANCELLED",
] as const;
type StatusFilter = (typeof STATUSES)[number];

const STATUS_LABEL: Record<string, string> = {
  NOT_RECEIVED: "Not received",
};

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-amber-100 text-amber-700",
  CLOSED: "bg-zinc-200 text-zinc-600",
  SENT: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-orange-100 text-orange-700",
  RECEIVED: "bg-green-100 text-green-700",
  NOT_RECEIVED: "bg-red-100 text-red-700",
  CANCELLED: "bg-zinc-100 text-zinc-500",
};

export function PurchaseOrdersView({
  canManage = true,
  isAdmin = false,
}: {
  canManage?: boolean;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openSaleId, setOpenSaleId] = useState<string | null>(null);
  const [billModal, setBillModal] = useState<{ poId: string; mode: "receive" | "bill" } | null>(
    null,
  );
  const [fromInvoiceOpen, setFromInvoiceOpen] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [resolving, setResolving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = filter === "ALL" ? "?take=500" : `?status=${filter}&take=500`;
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

  const filtered = useMemo(() => {
    const s = q.trim();
    if (!s) return pos;
    return pos.filter((po) =>
      matchesSearch(s, [po.poNumber, po.vendor, po.sale?.number ? `#${po.sale.number}` : ""]),
    );
  }, [pos, q]);

  const pg = usePaged(filtered);
  const pageIds = pg.pageItems.map((po) => po.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleOne(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    setSelected((cur) => {
      const next = new Set(cur);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function deleteOne(po: PurchaseOrder) {
    if (
      !confirm(
        `Delete purchase order ${po.poNumber}? This can't be undone. Any bills already recorded against it are kept, just unlinked from this PO.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await api(`/api/purchase-orders/${po.id}`, { method: "DELETE" });
      setSelected((cur) => {
        const next = new Set(cur);
        next.delete(po.id);
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete purchase order");
    } finally {
      setDeleting(false);
    }
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      !confirm(
        `Delete ${ids.length} purchase order${ids.length === 1 ? "" : "s"}? This can't be undone. Any bills already recorded against them are kept, just unlinked.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await api("/api/purchase-orders", { method: "DELETE", body: JSON.stringify({ ids }) });
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the selected purchase orders");
    } finally {
      setDeleting(false);
    }
  }

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
        <SearchBox value={q} onChange={setQ} placeholder="Search PO #, vendor, invoice #…" />
        <div className="ml-auto flex gap-1 rounded-md bg-zinc-100 p-1 text-sm">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded px-2.5 py-1 font-medium ${
                filter === s ? "bg-white shadow-sm" : "text-zinc-500"
              }`}
            >
              {s === "ALL" ? "All" : (STATUS_LABEL[s] ?? s[0] + s.slice(1).toLowerCase())}
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

      <div className="mb-2 flex items-center gap-2">
        {isAdmin && selected.size > 0 && (
          <>
            <button
              onClick={deleteSelected}
              disabled={deleting}
              className="btn-secondary h-8 text-xs text-red-600 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : `Delete selected (${selected.size})`}
            </button>
            <button onClick={() => setSelected(new Set())} className="btn-ghost h-8 text-xs">
              Clear selection
            </button>
          </>
        )}
        <Pager {...pg} className="ml-auto" />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              {isAdmin && (
                <th className="w-8 px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={togglePage}
                    aria-label="Select all purchase orders on this page"
                  />
                </th>
              )}
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
                <td colSpan={isAdmin ? 10 : 9} className="px-4 py-8 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : pg.total === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 10 : 9} className="px-4 py-8 text-center text-zinc-400">
                  {q.trim()
                    ? "No purchase orders match your search."
                    : `No purchase orders${filter === "ALL" ? " yet" : ` with status ${filter}`}.`}
                </td>
              </tr>
            ) : (
              pg.pageItems.map((po) => (
                <tr
                  key={po.id}
                  onClick={() => router.push(`/purchase-orders/${po.id}`)}
                  className="cursor-pointer hover:bg-zinc-50"
                >
                  {isAdmin && (
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(po.id)}
                        onChange={() => toggleOne(po.id)}
                        aria-label={`Select PO ${po.poNumber}`}
                      />
                    </td>
                  )}
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
                      {STATUS_LABEL[po.status] ?? po.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {new Date(po.createdAt).toLocaleDateString()}
                    {po.createdBy ? ` · ${po.createdBy.name}` : ""}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {canManage && (po.items ?? []).length > 0 && po.status !== "CANCELLED" && (
                      <>
                        {po.status !== "RECEIVED" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setBillModal({ poId: po.id, mode: "receive" });
                            }}
                            className="btn-secondary h-7 text-xs"
                          >
                            Receive
                          </button>
                        )}
                        {(po._count?.bills ?? 0) === 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setBillModal({ poId: po.id, mode: "bill" });
                            }}
                            className="btn-secondary ml-1.5 h-7 text-xs"
                          >
                            Copy to bill
                          </button>
                        )}
                      </>
                    )}
                    {isAdmin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteOne(po);
                        }}
                        disabled={deleting}
                        className="btn-ghost ml-1.5 h-7 text-xs text-red-500 disabled:opacity-50"
                      >
                        Delete
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

      {billModal && (
        <BillModal
          poId={billModal.poId}
          mode={billModal.mode}
          onClose={() => setBillModal(null)}
          onDone={load}
        />
      )}
    </div>
  );
}
