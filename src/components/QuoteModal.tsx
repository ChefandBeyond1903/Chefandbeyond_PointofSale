"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { formatMoney, formatBps } from "@/lib/money";
import { InvoiceModal } from "@/components/InvoiceModal";
import type { QuoteDetail } from "@/lib/types";

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

  const quote = detail?.quote;

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
                  <StatusPill status={quote.status} />
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
                  <button onClick={convertToInvoice} className="btn-primary ml-auto h-8 text-xs">
                    Convert to invoice →
                  </button>
                )}
              </div>
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
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  let cls = "bg-zinc-100 text-zinc-600";
  let label: string = status;
  if (status === "OPEN") {
    cls = "bg-amber-100 text-amber-800";
    label = "Open";
  } else if (status === "APPROVED") {
    cls = "bg-emerald-100 text-emerald-700";
    label = "Approved";
  } else if (status === "CONVERTED") {
    cls = "bg-indigo-100 text-indigo-700";
    label = "Converted";
  } else if (status === "REJECTED") {
    cls = "bg-red-100 text-red-700";
    label = "Rejected";
  }
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}
