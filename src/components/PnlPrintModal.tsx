"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { DateRangePicker } from "@/components/DateRangePicker";
import type { Company, ReportSummary } from "@/lib/types";
import type { DateRange, DateRangePresetKey } from "@/lib/dateRange";

/** "$1,234.50" -> "1,234.50" — magnitude only, for lines shown as deductions. */
function amt(cents: number): string {
  return formatMoney(Math.abs(cents)).replace("$", "");
}
/** Always parenthesised — for lines that are always a subtraction. */
function paren(cents: number): string {
  return `(${amt(cents)})`;
}
/** Sign-aware — for running subtotals/totals: "1,234.50" or "(1,234.50)". */
function signed(cents: number): string {
  return cents < 0 ? `(${amt(cents)})` : amt(cents);
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function PnlPrintModal({
  initialRange,
  initialLabel,
  initialPreset = "this_month",
  storeId,
  storeName,
  onClose,
}: {
  initialRange: DateRange;
  initialLabel: string;
  initialPreset?: DateRangePresetKey;
  storeId: string;
  storeName: string | null;
  onClose: () => void;
}) {
  const [range, setRange] = useState<DateRange>(initialRange);
  const [label, setLabel] = useState(initialLabel);
  const [data, setData] = useState<ReportSummary | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ company: Company }>("/api/company")
      .then((r) => setCompany(r.company))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    });
    if (storeId) qs.set("storeId", storeId);
    try {
      setData(await api<ReportSummary>(`/api/reports/summary?${qs.toString()}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the statement");
    } finally {
      setLoading(false);
    }
  }, [range, storeId]);

  useEffect(() => {
    load();
  }, [load]);

  const t = data?.totals;
  const grossAfterRefunds = t ? t.profitCents - t.refundedProfitCents : 0;
  const companyName = company?.name || company?.legalName || "Chef and Beyond";
  const scopeLabel = data?.scope.allStores
    ? "All stores"
    : (data?.scope.storeName ?? storeName ?? "");

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="w-full max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar — not printed */}
        <div className="no-print mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-white p-3 shadow-lg">
          <span className="text-sm font-semibold">Print Profit &amp; Loss</span>
          <DateRangePicker
            defaultPreset={initialPreset}
            onChange={(r, l) => {
              setRange(r);
              setLabel(l);
            }}
          />
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => window.print()}
              disabled={loading || !data}
              className="btn-primary"
            >
              Print
            </button>
            <button onClick={onClose} className="btn-secondary">
              Close
            </button>
          </div>
        </div>

        {error && (
          <p className="no-print mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {/* The statement */}
        <div
          id="pnl-print"
          className="rounded-lg bg-white p-8 text-[13px] leading-relaxed text-zinc-800 shadow-lg sm:p-10"
        >
          {!t ? (
            <p className="py-16 text-center text-sm text-zinc-400">Loading statement…</p>
          ) : (
            <>
              <header className="flex items-start justify-between gap-6 border-b-2 border-zinc-900 pb-4">
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-zinc-900">
                    {companyName}
                  </h1>
                  {company?.address ? (
                    <p className="mt-0.5 text-xs text-zinc-500">{company.address}</p>
                  ) : null}
                  {company?.phone ? (
                    <p className="text-xs text-zinc-500">{company.phone}</p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                    Profit &amp; Loss
                  </p>
                  <p className="mt-1 text-base font-semibold text-zinc-900">{label}</p>
                  <p className="text-xs text-zinc-500">
                    {fmtDay(data!.range.from)} – {fmtDay(data!.range.to)}
                  </p>
                  {scopeLabel ? (
                    <p className="text-xs text-zinc-500">{scopeLabel}</p>
                  ) : null}
                </div>
              </header>

              <div className="mt-6 space-y-5">
                <Section title="Revenue">
                  <PLLine
                    label="Gross sales (ex-tax)"
                    value={signed(t.subtotalCents - t.discountCents)}
                  />
                  <PLLine label="Cost of goods sold" value={paren(t.costCents)} muted />
                  <PLLine
                    label="Gross profit"
                    value={signed(t.profitCents)}
                    strong
                    rule
                    note={`${t.marginPct}% margin`}
                  />
                  {t.refundedProfitCents !== 0 && (
                    <PLLine label="Refunded profit" value={paren(t.refundedProfitCents)} muted />
                  )}
                  <PLLine
                    label="Gross profit after refunds"
                    value={signed(grossAfterRefunds)}
                    strong
                    rule
                  />
                </Section>

                <Section title="Operating expenses">
                  {data!.expensesByCategory.length === 0 ? (
                    <PLLine label="None recorded" value={amt(0)} muted />
                  ) : (
                    data!.expensesByCategory.map((e) => (
                      <PLLine
                        key={e.category}
                        label={e.category}
                        value={paren(e.amountCents)}
                        muted
                      />
                    ))
                  )}
                  <PLLine
                    label="Total operating expenses"
                    value={paren(t.expensesCents)}
                    strong
                    rule
                  />
                </Section>

                <Section title="Other">
                  <PLLine
                    label="Card processing fees (3% of card sales)"
                    value={paren(t.cardFeeCents)}
                    muted
                  />
                </Section>

                <div
                  className={`flex items-center justify-between border-y-[3px] border-double px-3 py-3 text-base font-bold ${
                    t.netProfitCents < 0
                      ? "border-red-700 bg-red-50 text-red-700"
                      : "border-zinc-900 bg-zinc-50 text-zinc-900"
                  }`}
                >
                  <span className="uppercase tracking-wide">
                    Net {t.netProfitCents < 0 ? "loss" : "profit"}
                  </span>
                  <span className="tabular-nums">{signed(t.netProfitCents)}</span>
                </div>
              </div>

              <footer className="mt-6 border-t border-zinc-200 pt-3 text-[11px] text-zinc-500">
                <p>All amounts in USD. Prepared {new Date().toLocaleString()}.</p>
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

function PLLine({
  label,
  value,
  muted,
  strong,
  rule,
  note,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
  rule?: boolean;
  note?: string;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-1 ${
        rule ? "mt-1 border-t border-zinc-300 pt-1.5" : ""
      } ${strong ? "font-semibold text-zinc-900" : ""}`}
    >
      <span className={muted ? "text-zinc-500" : ""}>
        {label}
        {note ? <span className="ml-2 text-[11px] font-normal text-zinc-400">{note}</span> : null}
      </span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}
