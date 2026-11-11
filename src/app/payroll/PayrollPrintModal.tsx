"use client";

import { createPortal } from "react-dom";
import { formatMoney } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";

export type PrintEntry = {
  id: string;
  nameSnapshot: string;
  payType: string;
  rateCents: number;
  regularHoursX100: number;
  overtimeHoursX100: number;
  grossCents: number;
  fedWithholdingCents: number;
  ssEmployeeCents: number;
  medicareEmployeeCents: number;
  addlMedicareCents: number;
  netPayCents: number;
  ssEmployerCents: number;
  medicareEmployerCents: number;
  futaCents: number;
  sutaCents: number;
};

export type PrintRun = {
  id: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  note: string;
  entries: PrintEntry[];
};

const hrs = (x100: number) => (x100 / 100).toFixed(2);

/**
 * Print-ready pay stubs (one per page) followed by a payroll register that
 * totals what the employer owes on top. Reuses the invoice print plumbing: the
 * #receipt target is the only thing that prints.
 */
export function PayrollPrintModal({
  run,
  companyName,
  onClose,
}: {
  run: PrintRun;
  companyName: string;
  onClose: () => void;
}) {
  const sum = (f: (e: PrintEntry) => number) => run.entries.reduce((s, e) => s + f(e), 0);
  const employerTotal = sum((e) => e.ssEmployerCents + e.medicareEmployerCents + e.futaCents + e.sutaCents);

  return createPortal(
    <div
      className="receipt-modal-overlay fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-black/40 p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="receipt-modal-card card max-h-[92vh] w-full max-w-3xl overflow-y-auto p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="receipt-modal-inner w-full">
          <div id="receipt" className="receipt-full text-sm">
            {run.entries.map((e) => {
              const deductions =
                e.fedWithholdingCents + e.ssEmployeeCents + e.medicareEmployeeCents + e.addlMedicareCents;
              return (
                <div key={e.id} className="mb-8 border-b border-dashed border-zinc-300 pb-6 [break-after:page]">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-lg font-bold">{companyName}</h2>
                      <p className="text-zinc-500">Pay stub</p>
                    </div>
                    <div className="text-right text-xs text-zinc-600">
                      <p>
                        Pay period {formatDateOnly(run.periodStart)} – {formatDateOnly(run.periodEnd)}
                      </p>
                      <p>Pay date {formatDateOnly(run.payDate)}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-base font-semibold">{e.nameSnapshot}</p>
                  <p className="text-xs text-zinc-500">
                    {e.payType === "SALARY"
                      ? `Salary — ${formatMoney(e.rateCents)} per pay period`
                      : `Hourly — ${formatMoney(e.rateCents)}/hr · ${hrs(e.regularHoursX100)} regular` +
                        (e.overtimeHoursX100 ? ` + ${hrs(e.overtimeHoursX100)} overtime (1.5×)` : "")}
                  </p>
                  <table className="mt-3 w-full">
                    <tbody>
                      <Line label="Gross pay" value={e.grossCents} bold />
                      <Line label="Federal income tax" value={-e.fedWithholdingCents} />
                      <Line label="Social Security (6.2%)" value={-e.ssEmployeeCents} />
                      <Line label="Medicare (1.45%)" value={-e.medicareEmployeeCents} />
                      {e.addlMedicareCents > 0 && (
                        <Line label="Additional Medicare (0.9%)" value={-e.addlMedicareCents} />
                      )}
                      <Line label="Total deductions" value={-deductions} />
                      <Line label="Net pay" value={e.netPayCents} bold top />
                    </tbody>
                  </table>
                  <p className="mt-3 text-[11px] text-zinc-400">
                    Tennessee has no state income tax on wages. Employer contributions (matching Social
                    Security and Medicare, unemployment) are paid by the company and are not deducted from
                    your pay.
                  </p>
                </div>
              );
            })}

            <div>
              <h2 className="text-lg font-bold">Payroll register — {companyName}</h2>
              <p className="text-xs text-zinc-500">
                Pay period {formatDateOnly(run.periodStart)} – {formatDateOnly(run.periodEnd)} · Pay date{" "}
                {formatDateOnly(run.payDate)}
                {run.note ? ` · ${run.note}` : ""}
              </p>
              <table className="mt-3 w-full text-xs">
                <thead className="text-left text-zinc-500">
                  <tr>
                    <th className="py-1">Employee</th>
                    <th className="py-1 text-right">Gross</th>
                    <th className="py-1 text-right">Fed tax</th>
                    <th className="py-1 text-right">SS</th>
                    <th className="py-1 text-right">Medicare</th>
                    <th className="py-1 text-right">Net pay</th>
                    <th className="py-1 text-right">Employer taxes</th>
                  </tr>
                </thead>
                <tbody>
                  {run.entries.map((e) => (
                    <tr key={e.id} className="border-t border-zinc-200">
                      <td className="py-1">{e.nameSnapshot}</td>
                      <td className="py-1 text-right">{formatMoney(e.grossCents)}</td>
                      <td className="py-1 text-right">{formatMoney(e.fedWithholdingCents)}</td>
                      <td className="py-1 text-right">{formatMoney(e.ssEmployeeCents)}</td>
                      <td className="py-1 text-right">
                        {formatMoney(e.medicareEmployeeCents + e.addlMedicareCents)}
                      </td>
                      <td className="py-1 text-right">{formatMoney(e.netPayCents)}</td>
                      <td className="py-1 text-right">
                        {formatMoney(e.ssEmployerCents + e.medicareEmployerCents + e.futaCents + e.sutaCents)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-zinc-400 font-semibold">
                    <td className="py-1">Total</td>
                    <td className="py-1 text-right">{formatMoney(sum((e) => e.grossCents))}</td>
                    <td className="py-1 text-right">{formatMoney(sum((e) => e.fedWithholdingCents))}</td>
                    <td className="py-1 text-right">{formatMoney(sum((e) => e.ssEmployeeCents))}</td>
                    <td className="py-1 text-right">
                      {formatMoney(sum((e) => e.medicareEmployeeCents + e.addlMedicareCents))}
                    </td>
                    <td className="py-1 text-right">{formatMoney(sum((e) => e.netPayCents))}</td>
                    <td className="py-1 text-right">{formatMoney(employerTotal)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-zinc-500">
                Employer taxes = matching Social Security + Medicare + federal and Tennessee unemployment.
              </p>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button onClick={() => window.print()} className="btn-secondary flex-1">
              Print
            </button>
            <button onClick={onClose} className="btn-primary flex-1">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Line({ label, value, bold, top }: { label: string; value: number; bold?: boolean; top?: boolean }) {
  return (
    <tr className={top ? "border-t border-zinc-300" : ""}>
      <td className={`py-0.5 ${bold ? "font-semibold" : ""}`}>{label}</td>
      <td className={`py-0.5 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
        {formatMoney(value)}
      </td>
    </tr>
  );
}
