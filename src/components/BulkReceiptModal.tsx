"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ReceiptBody } from "@/components/ReceiptModal";
import { PrintPaperToggle, usePrintPaper } from "@/components/PrintPaperToggle";
import type { Company, Sale } from "@/lib/types";

/**
 * Print several invoices in one go, one per page. Print CSS keys off
 * #bulk-receipts (see globals.css) — mirrors the single ReceiptModal's
 * #receipt handling but scoped to a class, since several receipts print at
 * once and can't share one id.
 */
export function BulkReceiptModal({
  sales,
  company: companyProp,
  onClose,
}: {
  sales: Sale[];
  company?: Company | null;
  onClose: () => void;
}) {
  const [company, setCompany] = useState<Company | null>(companyProp ?? null);
  const [paper, setPaper] = usePrintPaper();

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
          <p className="mb-3 text-sm font-medium">
            {sales.length} invoice{sales.length === 1 ? "" : "s"} selected
          </p>

          <div id="bulk-receipts" className="max-h-[60vh] space-y-3 overflow-y-auto">
            {sales.map((sale) => (
              <div
                key={sale.id}
                className={`bulk-receipt-doc rounded-md border border-zinc-200 p-4 font-mono text-xs receipt-${paper}`}
              >
                <ReceiptBody sale={sale} company={company} />
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <PrintPaperToggle value={paper} onChange={setPaper} />
            <div className="ml-auto flex flex-1 gap-2">
              <button
                onClick={() => window.print()}
                disabled={sales.length === 0}
                className="btn-secondary flex-1"
              >
                Print all
              </button>
              <button onClick={onClose} className="btn-primary flex-1">
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
