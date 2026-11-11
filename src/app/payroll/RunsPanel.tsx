"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, describeApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";
import type { Employee } from "./EmployeesPanel";
import { PayrollPrintModal, type PrintRun } from "./PayrollPrintModal";

type Preview = {
  employeeId: string;
  name: string;
  regularHoursX100: number;
  overtimeHoursX100: number;
  result: {
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
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const employerOf = (r: Preview["result"]) =>
  r.ssEmployerCents + r.medicareEmployerCents + r.futaCents + r.sutaCents;

export function RunsPanel({ companyName }: { companyName: string }) {
  const [runs, setRuns] = useState<PrintRun[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [printRun, setPrintRun] = useState<PrintRun | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, e] = await Promise.all([
        api<{ runs: PrintRun[] }>("/api/payroll/runs"),
        api<{ employees: Employee[] }>("/api/payroll/employees"),
      ]);
      setRuns(r.runs);
      setEmployees(e.employees);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load payroll");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function remove(run: PrintRun) {
    if (
      !confirm(
        `Delete the pay run for ${formatDateOnly(run.payDate)}? Do this newest-first if you need to redo several.`,
      )
    )
      return;
    try {
      await api(`/api/payroll/runs/${run.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete");
    }
  }

  if (creating) {
    return (
      <NewRun
        employees={employees.filter((e) => e.active)}
        lastEnd={runs[0]?.periodEnd?.slice(0, 10) ?? null}
        onCancel={() => setCreating(false)}
        onSaved={async (run) => {
          setCreating(false);
          await load();
          setPrintRun(run);
        }}
        companyName={companyName}
      />
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-zinc-500">Biweekly pay runs. Taxes are calculated for you.</p>
        <button className="btn-primary" onClick={() => setCreating(true)} disabled={employees.length === 0}>
          + New pay run
        </button>
      </div>
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
            <tr>
              <th className="px-4 py-2">Pay date</th>
              <th className="px-4 py-2">Period</th>
              <th className="px-4 py-2 text-right">Employees</th>
              <th className="px-4 py-2 text-right">Gross</th>
              <th className="px-4 py-2 text-right">Net pay</th>
              <th className="px-4 py-2 text-right">Employer taxes</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-zinc-400">
                  {employees.length === 0 ? "Add employees first, then run payroll." : "No pay runs yet."}
                </td>
              </tr>
            ) : (
              runs.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-medium">{formatDateOnly(r.payDate)}</td>
                  <td className="px-4 py-2 text-zinc-500">
                    {formatDateOnly(r.periodStart)} – {formatDateOnly(r.periodEnd)}
                  </td>
                  <td className="px-4 py-2 text-right">{r.entries.length}</td>
                  <td className="px-4 py-2 text-right">
                    {formatMoney(r.entries.reduce((s, e) => s + e.grossCents, 0))}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatMoney(r.entries.reduce((s, e) => s + e.netPayCents, 0))}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatMoney(
                      r.entries.reduce(
                        (s, e) => s + e.ssEmployerCents + e.medicareEmployerCents + e.futaCents + e.sutaCents,
                        0,
                      ),
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button className="btn-ghost text-xs" onClick={() => setPrintRun(r)}>
                      Print
                    </button>
                    <button className="btn-ghost text-xs text-red-500" onClick={() => remove(r)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {printRun && <PayrollPrintModal run={printRun} companyName={companyName} onClose={() => setPrintRun(null)} />}
    </div>
  );
}

function NewRun({
  employees,
  lastEnd,
  onCancel,
  onSaved,
  companyName,
}: {
  employees: Employee[];
  lastEnd: string | null;
  onCancel: () => void;
  onSaved: (run: PrintRun) => void;
  companyName: string;
}) {
  void companyName;
  const defStart = lastEnd ? addDays(lastEnd, 1) : iso(new Date());
  const [start, setStart] = useState(defStart);
  const [end, setEnd] = useState(addDays(defStart, 13));
  const [payDate, setPayDate] = useState(addDays(defStart, 13));
  const [note, setNote] = useState("");
  const [include, setInclude] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(employees.map((e) => [e.id, true])),
  );
  const [hours, setHours] = useState<Record<string, { reg: string; ot: string }>>(() =>
    Object.fromEntries(employees.map((e) => [e.id, { reg: e.payType === "HOURLY" ? "80" : "", ot: "" }])),
  );
  const [preview, setPreview] = useState<Record<string, Preview>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const entries = useMemo(
    () =>
      employees
        .filter((e) => include[e.id])
        .map((e) => ({
          employeeId: e.id,
          regularHours: parseFloat(hours[e.id]?.reg ?? "") || 0,
          overtimeHours: parseFloat(hours[e.id]?.ot ?? "") || 0,
        })),
    [employees, include, hours],
  );

  useEffect(() => {
    if (entries.length === 0 || !payDate) {
      setPreview({});
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api<{ lines: Preview[] }>("/api/payroll/runs", {
          method: "POST",
          body: JSON.stringify({ periodStart: start, periodEnd: end, payDate, dryRun: true, entries }),
        });
        setPreview(Object.fromEntries(r.lines.map((l) => [l.employeeId, l])));
        setError(null);
      } catch (e) {
        setPreview({});
        setError(describeApiError(e, "Could not calculate"));
      }
    }, 350);
    return () => clearTimeout(t);
  }, [entries, payDate, start, end]);

  const lines = Object.values(preview);
  const sum = (f: (p: Preview) => number) => lines.reduce((s, p) => s + f(p), 0);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ run: PrintRun }>("/api/payroll/runs", {
        method: "POST",
        body: JSON.stringify({ periodStart: start, periodEnd: end, payDate, note, entries }),
      });
      onSaved(r.run);
    } catch (e) {
      setError(describeApiError(e, "Could not save the pay run"));
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">New pay run</h2>
        <button className="btn-ghost text-sm" onClick={onCancel}>
          ← Back
        </button>
      </div>
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-4">
        <div>
          <label className="label">Period start</label>
          <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="label">Period end</label>
          <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div>
          <label className="label">Pay date</label>
          <input type="date" className="input" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Note</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
            <tr>
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2">Employee</th>
              <th className="px-3 py-2">Hours / OT</th>
              <th className="px-3 py-2 text-right">Gross</th>
              <th className="px-3 py-2 text-right">Fed tax</th>
              <th className="px-3 py-2 text-right">SS + Medicare</th>
              <th className="px-3 py-2 text-right">Net pay</th>
              <th className="px-3 py-2 text-right">Employer taxes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {employees.map((e) => {
              const p = preview[e.id];
              return (
                <tr key={e.id} className={include[e.id] ? "" : "text-zinc-300"}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={!!include[e.id]}
                      onChange={(ev) => setInclude((cur) => ({ ...cur, [e.id]: ev.target.checked }))}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {e.firstName} {e.lastName}
                    <span className="ml-1 text-[11px] font-normal text-zinc-400">
                      {e.payType === "SALARY" ? "salary" : "hourly"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {e.payType === "HOURLY" ? (
                      <div className="flex items-center gap-1">
                        <input
                          className="input h-8 w-16 text-right"
                          inputMode="decimal"
                          value={hours[e.id]?.reg ?? ""}
                          onChange={(ev) =>
                            setHours((cur) => ({ ...cur, [e.id]: { ...cur[e.id], reg: ev.target.value } }))
                          }
                        />
                        <span className="text-zinc-400">+</span>
                        <input
                          className="input h-8 w-14 text-right"
                          inputMode="decimal"
                          placeholder="OT"
                          value={hours[e.id]?.ot ?? ""}
                          onChange={(ev) =>
                            setHours((cur) => ({ ...cur, [e.id]: { ...cur[e.id], ot: ev.target.value } }))
                          }
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-400">fixed</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{p ? formatMoney(p.result.grossCents) : "—"}</td>
                  <td className="px-3 py-2 text-right">{p ? formatMoney(p.result.fedWithholdingCents) : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {p
                      ? formatMoney(
                          p.result.ssEmployeeCents + p.result.medicareEmployeeCents + p.result.addlMedicareCents,
                        )
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{p ? formatMoney(p.result.netPayCents) : "—"}</td>
                  <td className="px-3 py-2 text-right text-zinc-500">{p ? formatMoney(employerOf(p.result)) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          {lines.length > 0 && (
            <tfoot className="border-t-2 border-zinc-200 text-sm font-semibold">
              <tr>
                <td></td>
                <td className="px-3 py-2">Total</td>
                <td></td>
                <td className="px-3 py-2 text-right">{formatMoney(sum((p) => p.result.grossCents))}</td>
                <td className="px-3 py-2 text-right">{formatMoney(sum((p) => p.result.fedWithholdingCents))}</td>
                <td className="px-3 py-2 text-right">
                  {formatMoney(
                    sum((p) => p.result.ssEmployeeCents + p.result.medicareEmployeeCents + p.result.addlMedicareCents),
                  )}
                </td>
                <td className="px-3 py-2 text-right">{formatMoney(sum((p) => p.result.netPayCents))}</td>
                <td className="px-3 py-2 text-right">{formatMoney(sum((p) => employerOf(p.result)))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-[11px] text-zinc-400">
        Federal income tax follows IRS Pub. 15-T (2026) using each employee&rsquo;s W-4. Social Security stops at
        the yearly wage cap, and unemployment taxes stop at $7,000 of wages, based on pay already run this
        year. Overtime is paid at 1.5× the hourly rate.
      </p>
      <div className="mt-4 flex gap-2">
        <button className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary ml-auto" onClick={save} disabled={saving || lines.length === 0}>
          {saving ? "Saving…" : "Save pay run & print"}
        </button>
      </div>
    </div>
  );
}
