"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";
import { INVOICE_FINE_PRINT } from "@/components/ReceiptModal";
import type { Company, Sale, SaleRefund } from "@/lib/types";

function methodLabel(r: SaleRefund): string {
  if (r.method === "CHECK") return r.checkNumber ? `Check #${r.checkNumber}` : "Check";
  if (r.method === "CREDIT") return "Store credit";
  if (r.method === "CARD") return "Card";
  return "Cash";
}

/**
 * A printable refund slip for one SaleRefund. Pass the loaded `sale` (with its
 * `refunds`) and either the `refund` or a `refundId` to pick from `sale.refunds`.
 * Reuses `#receipt` so the existing print CSS prints only this.
 */
export function RefundReceiptModal({
  sale,
  refund: refundProp,
  refundId,
  company: companyProp,
  onClose,
  closeLabel = "Close",
}: {
  sale: Sale;
  refund?: SaleRefund;
  refundId?: string;
  company?: Company | null;
  onClose: () => void;
  closeLabel?: string;
}) {
  const [company, setCompany] = useState<Company | null>(companyProp ?? null);

  useEffect(() => {
    if (companyProp !== undefined) return;
    let alive = true;
    api<{ company: Company }>("/api/company")
      .then((r) => alive && setCompany(r.company))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [companyProp]);

  const refund =
    refundProp ?? (sale.refunds ?? []).find((r) => r.id === refundId) ?? (sale.refunds ?? [])[0];

  const totalRefunded = sale.refundedCents ?? 0;
  const fully = totalRefunded >= sale.totalCents;
  const customer = sale.customerCompanySnapshot || sale.customerNameSnapshot || "";

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-black/40 p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="card max-h-[92vh] w-full max-w-sm overflow-y-auto p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full">
          {!refund ? (
            <p className="py-8 text-center text-sm text-zinc-500">No refund to show.</p>
          ) : (
            <div id="receipt" className="rounded-md border border-zinc-200 p-4 font-mono text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-header.webp"
                alt="Chef and Beyond"
                className="mx-auto mb-2 h-10 w-auto"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              {sale.storeNameSnapshot ? (
                <p className="text-center text-zinc-500">{sale.storeNameSnapshot}</p>
              ) : null}
              {(sale.storeAddressSnapshot || company?.address) && (
                <p className="text-center text-zinc-500">
                  {sale.storeAddressSnapshot || company?.address}
                </p>
              )}
              {(sale.storePhoneSnapshot || company?.phone) && (
                <p className="text-center text-zinc-500">
                  {sale.storePhoneSnapshot || company?.phone}
                </p>
              )}

              <p className="mt-2 text-center text-sm font-bold tracking-wide">REFUND</p>
              <p className="text-center text-zinc-500">against Sale #{sale.number}</p>
              <p className="text-center text-zinc-500">{new Date(refund.refundedAt).toLocaleString()}</p>
              {refund.createdBy?.name ? (
                <p className="text-center text-zinc-500">Processed by: {refund.createdBy.name}</p>
              ) : null}
              {customer ? (
                <p className="text-center text-zinc-500">Customer: {customer}</p>
              ) : null}

              <hr className="my-2 border-dashed" />

              <div className="flex justify-between">
                <span>Original total</span>
                <span>{formatMoney(sale.totalCents)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Refunded now</span>
                <span>− {formatMoney(refund.amountCents)}</span>
              </div>
              <div className="flex justify-between">
                <span>Refund method</span>
                <span>{methodLabel(refund)}</span>
              </div>
              {refund.restocked ? (
                <p className="mt-1 text-zinc-500">Items returned to stock.</p>
              ) : (
                <p className="mt-1 text-zinc-500">Items not restocked.</p>
              )}
              {refund.reason ? (
                <p className="mt-1 whitespace-pre-line text-zinc-600">Reason: {refund.reason}</p>
              ) : null}

              <hr className="my-2 border-dashed" />

              <div className="flex justify-between">
                <span>Total refunded to date</span>
                <span>{formatMoney(totalRefunded)}</span>
              </div>
              {!fully && (
                <div className="flex justify-between">
                  <span>Kept by customer</span>
                  <span>{formatMoney(Math.max(0, sale.totalCents - totalRefunded))}</span>
                </div>
              )}
              <p className="mt-2 text-center font-bold">
                {fully ? "FULLY REFUNDED" : "PARTIAL REFUND"}
              </p>
              {refund.method === "CHECK" ? (
                <p className="mt-1 text-center text-zinc-500">
                  Refund check{refund.checkNumber ? ` #${refund.checkNumber}` : ""} — allow time for
                  mailing / clearing.
                </p>
              ) : refund.method === "CREDIT" ? (
                <p className="mt-1 text-center text-zinc-500">
                  Amount added to the customer&apos;s store credit.
                </p>
              ) : null}

              <hr className="my-2 border-dashed" />
              <p className="text-[10px] leading-snug text-zinc-500">{INVOICE_FINE_PRINT}</p>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => window.print()}
              disabled={!refund}
              className="btn-secondary flex-1"
            >
              Print
            </button>
            <button onClick={onClose} className="btn-primary flex-1">
              {closeLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
