"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { formatBps, formatMoney } from "@/lib/money";
import { PrintPaperToggle, usePrintPaper } from "@/components/PrintPaperToggle";
import type { Company, Quote } from "@/lib/types";

// Printed on every quote.
export const QUOTE_FINE_PRINT =
  "This is a price quote, not an invoice — nothing has been charged. Prices, availability, and " +
  "estimated tax are subject to change until an order is placed. Valid for 30 days from the date " +
  "above unless stated otherwise.";

/**
 * The printable version of a quote — same look as the sale receipt (logo,
 * store, line items, totals, fine print), but labeled QUOTE and with no
 * payment/tender section, since nothing has been charged. Pass a loaded
 * `quote`, or a `quoteId` to have it fetched (re-printing from the list).
 * Print CSS keys off `#receipt`, so `window.print()` prints only this — the
 * browser's own "Save as PDF" destination covers saving a copy.
 */
export function QuoteReceiptModal({
  quote: quoteProp,
  quoteId,
  company: companyProp,
  onClose,
  closeLabel = "Close",
}: {
  quote?: Quote;
  quoteId?: string;
  company?: Company | null;
  onClose: () => void;
  closeLabel?: string;
}) {
  const [quote, setQuote] = useState<Quote | null>(quoteProp ?? null);
  const [company, setCompany] = useState<Company | null>(companyProp ?? null);
  const [error, setError] = useState<string | null>(null);
  const [paper, setPaper] = usePrintPaper();

  useEffect(() => {
    if (quoteProp || !quoteId) return;
    let alive = true;
    api<{ quote: Quote }>(`/api/quotes/${quoteId}`)
      .then((r) => alive && setQuote(r.quote))
      .catch(() => alive && setError("Could not load this quote."));
    return () => {
      alive = false;
    };
  }, [quoteId, quoteProp]);

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
        className={`card max-h-[92vh] w-full overflow-y-auto p-4 sm:p-6 ${
          paper === "full" ? "max-w-xl" : "max-w-sm"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full">
          {!quote ? (
            <p className="py-8 text-center text-sm text-zinc-500">{error ?? "Loading quote…"}</p>
          ) : (
            <div
              id="receipt"
              className={`rounded-md border border-zinc-200 p-4 font-mono text-xs receipt-${paper}`}
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
              <p className="text-center text-sm font-bold tracking-wide">QUOTE</p>
              {quote.storeNameSnapshot ? (
                <p className="text-center text-zinc-500">{quote.storeNameSnapshot}</p>
              ) : null}
              {company?.address ? (
                <p className="text-center text-zinc-500">{company.address}</p>
              ) : null}
              {company?.phone ? <p className="text-center text-zinc-500">{company.phone}</p> : null}
              <p className="text-center text-zinc-500">Quote Q-{quote.number}</p>
              <p className="text-center text-zinc-500">
                {new Date(quote.createdAt).toLocaleString()}
              </p>
              {quote.createdBy?.name ? (
                <p className="text-center text-zinc-500">Prepared by: {quote.createdBy.name}</p>
              ) : null}
              {quote.customerCompanySnapshot || quote.customerNameSnapshot ? (
                <p className="text-center text-zinc-500">
                  Customer: {quote.customerCompanySnapshot || quote.customerNameSnapshot}
                  {quote.customerCompanySnapshot &&
                  quote.customerNameSnapshot &&
                  quote.customerNameSnapshot !== quote.customerCompanySnapshot
                    ? ` (${quote.customerNameSnapshot})`
                    : ""}
                  {quote.customerLocationSnapshot ? ` — ${quote.customerLocationSnapshot}` : ""}
                </p>
              ) : null}
              {quote.customerLocationSnapshot && quote.customerAddressSnapshot ? (
                <p className="text-center text-zinc-500">{quote.customerAddressSnapshot}</p>
              ) : null}
              {quote.note ? (
                <p className="mt-1 whitespace-pre-line text-center text-zinc-600">{quote.note}</p>
              ) : null}
              <hr className="my-2 border-dashed" />
              {quote.items.map((it) => (
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
                <span>{formatMoney(quote.subtotalCents)}</span>
              </div>
              {quote.discountCents !== 0 && (
                <div className="flex justify-between">
                  <span>Discount</span>
                  <span>− {formatMoney(quote.discountCents)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>
                  Tax{quote.taxRateBps ? ` (${formatBps(quote.taxRateBps)} est.)` : " (est.)"}
                </span>
                <span>{formatMoney(quote.taxCents)}</span>
              </div>
              {quote.shippingCents > 0 && (
                <div className="flex justify-between">
                  <span>Shipping</span>
                  <span>{formatMoney(quote.shippingCents)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold">
                <span>Estimated total</span>
                <span>{formatMoney(quote.totalCents)}</span>
              </div>
              {(() => {
                const listSub = quote.listSubtotalCents || quote.subtotalCents;
                const saved = listSub - (quote.subtotalCents - quote.discountCents);
                if (saved <= 0) return null;
                return (
                  <p className="mt-1 text-center font-bold">
                    You save {formatMoney(saved)}
                    {listSub > 0 ? ` (${Math.round((saved / listSub) * 100)}% off)` : ""}
                  </p>
                );
              })()}
              <hr className="my-2 border-dashed" />
              <p className="text-[10px] leading-snug text-zinc-500">{QUOTE_FINE_PRINT}</p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <PrintPaperToggle value={paper} onChange={setPaper} />
            <div className="ml-auto flex flex-1 gap-2">
              <button
                onClick={() => window.print()}
                disabled={!quote}
                className="btn-secondary flex-1"
              >
                Print / Save as PDF
              </button>
              <button onClick={onClose} className="btn-primary flex-1">
                {closeLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
