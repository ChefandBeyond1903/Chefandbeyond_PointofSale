"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";

type Report = {
  year: number;
  quarter: number;
  totals: {
    employeeCount: number;
    checkCount: number;
    grossCents: number;
    fedWithholdingCents: number;
    ssEmployeeCents: number;
    ssEmployerCents: number;
    medicareEmployeeCents: number;
    medicareEmployerCents: number;
    addlMedicareCents: number;
    futaCents: number;
    sutaCents: number;
    netPayCents: number;
  };
  employeeWithheldCents: number;
  employerShareCents: number;
  form941Cents: number;
  totalCostCents: number;
  employees: {
    employeeId: string;
    name: string;
    grossCents: number;
    fedWithholdingCents: number;
    ficaEmployeeCents: number;
    employerCents: number;
  }[];
};

const DUE: Record<number, string> = {
  1: "Form 941 due Apr 30 · TN unemployment report due Apr 30",
  2: "Form 941 due Jul 31 · TN unemployment report due Jul 31",
  3: "Form 941 due Oct 31 · TN unemployment report due Oct 31",
  4: "Form 941 due Jan 31 · Form 940 (FUTA) due Jan 31 · TN unemployment report due Jan 31",
};

export function QuarterlyPanel() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<Report>(`/api/payroll/quarterly?year=${year}&quarter=${quarter}`)
      .then((r) => alive && (setData(r), setError(null)))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "Could not load"));
    return () => {
      alive = false;
    };
  }, [year, quarter]);

  const t = data?.totals;
  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <select className="input h-9 w-auto" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))}>
          {[now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          className="input h-9 w-auto"
          value={quarter}
          onChange={(e) => setQuarter(parseInt(e.target.value, 10))}
        >
          <option value={1}>Q1 (Jan–Mar)</option>
          <option value={2}>Q2 (Apr–Jun)</option>
          <option value={3}>Q3 (Jul–Sep)</option>
          <option value={4}>Q4 (Oct–Dec)</option>
        </select>
        <button className="btn-secondary ml-auto h-9" onClick={() => window.print()}>
          Print
        </button>
      </div>
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!data || !t ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : t.checkCount === 0 ? (
        <p className="card p-6 text-center text-sm text-zinc-400">
          No payroll was paid in Q{quarter} {year}.
        </p>
      ) : (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            Q{data.quarter} {data.year} payroll taxes
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Federal deposit (Form 941)" value={data.form941Cents} note="Income tax withheld + all Social Security & Medicare" />
            <Stat label="Federal unemployment (FUTA)" value={t.futaCents} note="Employer only · filed yearly on Form 940" />
            <Stat label="Tennessee unemployment (SUTA)" value={t.sutaCents} note="Employer only · TN Dept. of Labor" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Withheld from employees" value={data.employeeWithheldCents} note="Held in trust — you owe this to the IRS" />
            <Stat label="Employer share (on top of wages)" value={data.employerShareCents} note="Matching SS & Medicare + FUTA + SUTA" />
            <Stat label="Total payroll cost" value={data.totalCostCents} note="Gross wages + employer share" />
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="px-4 py-2">Detail</th>
                  <th className="px-4 py-2 text-right">Employee</th>
                  <th className="px-4 py-2 text-right">Employer</th>
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                <Row label="Gross wages" a={t.grossCents} />
                <Row label="Federal income tax withheld" a={t.fedWithholdingCents} />
                <Row label="Social Security (6.2% each)" a={t.ssEmployeeCents} b={t.ssEmployerCents} />
                <Row label="Medicare (1.45% each)" a={t.medicareEmployeeCents} b={t.medicareEmployerCents} />
                {t.addlMedicareCents > 0 && <Row label="Additional Medicare (0.9%)" a={t.addlMedicareCents} />}
                <Row label="Federal unemployment (FUTA)" b={t.futaCents} />
                <Row label="Tennessee unemployment (SUTA)" b={t.sutaCents} />
                <Row label="Net pay to employees" a={t.netPayCents} />
              </tbody>
            </table>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="px-4 py-2">Employee</th>
                  <th className="px-4 py-2 text-right">Gross</th>
                  <th className="px-4 py-2 text-right">Fed tax</th>
                  <th className="px-4 py-2 text-right">SS + Medicare (employee)</th>
                  <th className="px-4 py-2 text-right">Employer taxes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.employees.map((e) => (
                  <tr key={e.employeeId}>
                    <td className="px-4 py-2 font-medium">{e.name}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(e.grossCents)}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(e.fedWithholdingCents)}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(e.ficaEmployeeCents)}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(e.employerCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-zinc-400">
            {DUE[data.quarter]}. Based on pay dates in the quarter. Figures are calculated estimates — confirm
            with your accountant or payroll provider before filing or depositing.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(value)}</p>
      <p className="mt-1 text-[11px] text-zinc-400">{note}</p>
    </div>
  );
}

function Row({ label, a, b }: { label: string; a?: number; b?: number }) {
  return (
    <tr>
      <td className="px-4 py-2">{label}</td>
      <td className="px-4 py-2 text-right">{a !== undefined ? formatMoney(a) : "—"}</td>
      <td className="px-4 py-2 text-right">{b !== undefined ? formatMoney(b) : "—"}</td>
      <td className="px-4 py-2 text-right font-medium">{formatMoney((a ?? 0) + (b ?? 0))}</td>
    </tr>
  );
}
