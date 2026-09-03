"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { formatBps, formatMoney } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";
import type { Company, Sale } from "@/lib/types";

// Printed on every invoice/receipt.
export const INVOICE_FINE_PRINT =
  "ALL SALES ARE FINAL. Changes after 48 hours may incur a fee (refund subject to a " +
  "restocking fee of 30% of the total purchase price or more depends on the vendor). " +
  "Installation, electrical, roofing, ducting, construction, permits, stainless steel panels, " +
  "shrouds, duct enclosures, fire wrap, fire system connection, and testing are NOT INCLUDED " +
  "unless stated in writing. Buyer must comply with local regulations. Seller is not liable for " +
  "indirect damages. Tennessee laws apply.";

/**
 * The printable receipt / invoice for one completed sale. Pass a loaded `sale`,
 * or a `saleId` to have it fetched (used for re-printing from an invoice list).
 * Print CSS keys off `#receipt`, so `window.print()` prints only this.
 */
export function ReceiptModal({
  sale: saleProp,
  saleId,
  company: companyProp,
  onClose,
  closeLabel = "Close",
}: {
  sale?: Sale;
  saleId?: string;
  company?: Company | null;
  onClose: () => void;
  closeLabel?: string;
}) {
  const [sale, setSale] = useState<Sale | null>(saleProp ?? null);
  const [company, setCompany] = useState<Company | null>(companyProp ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (saleProp || !saleId) return;
    let alive = true;
    api<{ sale: Sale }>(`/api/sales/${saleId}`)
      .then((r) => alive && setSale(r.sale))
      .catch(() => alive && setError("Could not load this invoice."));
    return () => {
      alive = false;
    };
  }, [saleId, saleProp]);

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
          {!sale ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {error ?? "Loading invoice…"}
            </p>
          ) : (
            <div
              id="receipt"
              className="rounded-md border border-zinc-200 p-4 font-mono text-xs"
            >
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
              <p className="text-center text-zinc-500">Sale #{sale.number}</p>
              <p className="text-center text-zinc-500">
                {new Date(sale.createdAt).toLocaleString()}
              </p>
              {sale.salesperson?.name ? (
                <p className="text-center text-zinc-500">Served by: {sale.salesperson.name}</p>
              ) : null}
              {sale.customerNameSnapshot ? (
                <p className="text-center text-zinc-500">Customer: {sale.customerNameSnapshot}</p>
              ) : null}
              {sale.dueDate ? (
                <p className="text-center text-zinc-500">
                  {sale.termsSnapshot ? `${sale.termsSnapshot} — ` : ""}Due{" "}
                  {formatDateOnly(sale.dueDate)}
                </p>
              ) : null}
              {sale.customerTaxExemptSnapshot ? (
                <p className="text-center text-zinc-500">Tax-exempt sale</p>
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
              {sale.discountCents !== 0 && (
                <div className="flex justify-between">
                  <span>Discount</span>
                  <span>− {formatMoney(sale.discountCents)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Tax{sale.taxRateBps ? ` (${formatBps(sale.taxRateBps)})` : ""}</span>
                <span>{formatMoney(sale.taxCents)}</span>
              </div>
              {sale.shippingCents > 0 && (
                <div className="flex justify-between">
                  <span>Shipping</span>
                  <span>{formatMoney(sale.shippingCents)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold">
                <span>Total</span>
                <span>{formatMoney(sale.totalCents)}</span>
              </div>
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
              {(() => {
                const listSub = sale.listSubtotalCents || sale.subtotalCents;
                const saved = listSub - (sale.subtotalCents - sale.discountCents);
                if (saved <= 0) return null;
                return (
                  <p className="mt-1 text-center font-bold">
                    You saved {formatMoney(saved)}
                    {listSub > 0 ? ` (${Math.round((saved / listSub) * 100)}% off)` : ""}
                  </p>
                );
              })()}
              <hr className="my-2 border-dashed" />
              <p className="text-[10px] leading-snug text-zinc-500">{INVOICE_FINE_PRINT}</p>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => window.print()}
              disabled={!sale}
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
