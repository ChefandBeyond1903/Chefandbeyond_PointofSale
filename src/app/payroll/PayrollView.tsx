"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { MoneyInput } from "@/components/MoneyInput";
import { EmployeesPanel } from "./EmployeesPanel";
import { RunsPanel } from "./RunsPanel";
import { QuarterlyPanel } from "./QuarterlyPanel";

type Tab = "runs" | "employees" | "quarterly" | "settings";

const TABS: { key: Tab; label: string }[] = [
  { key: "runs", label: "Pay runs" },
  { key: "employees", label: "Employees" },
  { key: "quarterly", label: "Quarterly report" },
  { key: "settings", label: "Tax settings" },
];

export function PayrollView() {
  const [tab, setTab] = useState<Tab>("runs");
  const [companyName, setCompanyName] = useState("Chef and Beyond");

  useEffect(() => {
    api<{ company: { name: string; legalName: string } }>("/api/company")
      .then((r) => setCompanyName(r.company.legalName || r.company.name || "Chef and Beyond"))
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 p-4">
      <h1 className="mb-3 text-xl font-semibold">Payroll</h1>
      <div className="no-print mb-4 flex flex-wrap gap-1 border-b border-zinc-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === t.key
                ? "border-indigo-600 font-medium text-indigo-700"
                : "border-transparent text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "runs" && <RunsPanel companyName={companyName} />}
      {tab === "employees" && <EmployeesPanel />}
      {tab === "quarterly" && <QuarterlyPanel />}
      {tab === "settings" && <SettingsPanel />}
    </div>
  );
}

type Settings = {
  sutaRateBps: number;
  sutaWageBaseCents: number;
  futaRateBps: number;
  futaWageBaseCents: number;
  employerEin: string;
};

function SettingsPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [sutaPct, setSutaPct] = useState("");
  const [futaPct, setFutaPct] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ settings: Settings }>("/api/payroll/settings")
      .then((r) => {
        setS(r.settings);
        setSutaPct(String(r.settings.sutaRateBps / 100));
        setFutaPct(String(r.settings.futaRateBps / 100));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load"));
  }, []);

  async function save() {
    if (!s) return;
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      await api("/api/payroll/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...s,
          sutaRateBps: Math.round((parseFloat(sutaPct) || 0) * 100),
          futaRateBps: Math.round((parseFloat(futaPct) || 0) * 100),
        }),
      });
      setMsg("Saved. New pay runs use these rates.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  if (!s) return <p className="text-sm text-zinc-400">{error ?? "Loading…"}</p>;
  return (
    <div className="card max-w-xl p-5">
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {msg && <p className="mb-3 rounded bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Tennessee unemployment rate (%)</label>
          <input className="input" inputMode="decimal" value={sutaPct} onChange={(e) => setSutaPct(e.target.value)} />
          <p className="mt-0.5 text-[11px] text-zinc-400">
            2.70% is the new-employer rate. Use the rate on your Tennessee Dept. of Labor notice.
          </p>
        </div>
        <div>
          <label className="label">TN unemployment wage base</label>
          <MoneyInput cents={s.sutaWageBaseCents} onCentsChange={(c) => setS({ ...s, sutaWageBaseCents: c })} />
          <p className="mt-0.5 text-[11px] text-zinc-400">$7,000 per employee per year.</p>
        </div>
        <div>
          <label className="label">Federal unemployment (FUTA) rate (%)</label>
          <input className="input" inputMode="decimal" value={futaPct} onChange={(e) => setFutaPct(e.target.value)} />
          <p className="mt-0.5 text-[11px] text-zinc-400">0.6% after the state credit (6.0% − 5.4%).</p>
        </div>
        <div>
          <label className="label">FUTA wage base</label>
          <MoneyInput cents={s.futaWageBaseCents} onCentsChange={(c) => setS({ ...s, futaWageBaseCents: c })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Employer EIN</label>
          <input
            className="input"
            value={s.employerEin}
            onChange={(e) => setS({ ...s, employerEin: e.target.value })}
            placeholder="12-3456789"
          />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-zinc-400">
        Social Security (6.2% up to the yearly wage cap), Medicare (1.45%) and federal income tax tables follow
        the IRS for the pay date&rsquo;s year and are built in.
      </p>
      <button className="btn-primary mt-4" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
