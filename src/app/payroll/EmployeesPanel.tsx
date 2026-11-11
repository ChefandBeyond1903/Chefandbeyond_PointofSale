"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, describeApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { MoneyInput } from "@/components/MoneyInput";

export type EmployeeDoc = { id: string; kind: string; fileName: string; createdAt: string };

export type Employee = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  ssnLast4: string;
  hireDate: string | null;
  active: boolean;
  notes: string;
  payType: "HOURLY" | "SALARY";
  hourlyRateCents: number;
  annualSalaryCents: number;
  filingStatus: "SINGLE" | "MFJ" | "HOH";
  w4Step2Checked: boolean;
  w4CreditsCents: number;
  w4OtherIncomeCents: number;
  w4DeductionsCents: number;
  w4ExtraWithholdingCents: number;
  documents: EmployeeDoc[];
};

const blank = (): Employee => ({
  id: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  street: "",
  city: "",
  state: "TN",
  zip: "",
  ssnLast4: "",
  hireDate: null,
  active: true,
  notes: "",
  payType: "HOURLY",
  hourlyRateCents: 0,
  annualSalaryCents: 0,
  filingStatus: "SINGLE",
  w4Step2Checked: false,
  w4CreditsCents: 0,
  w4OtherIncomeCents: 0,
  w4DeductionsCents: 0,
  w4ExtraWithholdingCents: 0,
  documents: [],
});

const KIND_LABEL: Record<string, string> = {
  W4: "W-4",
  I9: "I-9",
  W9: "W-9",
  ID: "ID",
  OTHER: "Other",
};

export function EmployeesPanel({ onChanged }: { onChanged?: () => void }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Employee | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ employees: Employee[] }>("/api/payroll/employees");
      setEmployees(r.employees);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load employees");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Wages and tax details are visible to admins only. Attach each person&rsquo;s W-4, I-9 and ID
          to their record.
        </p>
        <button className="btn-primary" onClick={() => setDraft(blank())}>
          + Add employee
        </button>
      </div>
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Pay</th>
              <th className="px-4 py-2">W-4</th>
              <th className="px-4 py-2">Documents</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : employees.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-400">
                  No employees yet.
                </td>
              </tr>
            ) : (
              employees.map((e) => (
                <tr key={e.id} className={e.active ? "" : "text-zinc-400"}>
                  <td className="px-4 py-2 font-medium">
                    {e.firstName} {e.lastName}
                    {!e.active && <span className="ml-2 text-xs">(inactive)</span>}
                  </td>
                  <td className="px-4 py-2">
                    {e.payType === "SALARY"
                      ? `${formatMoney(e.annualSalaryCents)}/yr`
                      : `${formatMoney(e.hourlyRateCents)}/hr`}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {{ SINGLE: "Single / MFS", MFJ: "Married jointly", HOH: "Head of household" }[e.filingStatus]}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {e.documents.length
                      ? e.documents.map((d) => KIND_LABEL[d.kind] ?? d.kind).join(", ")
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button className="btn-ghost text-xs" onClick={() => setDraft(e)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {draft && (
        <EmployeeModal
          initial={draft}
          onClose={() => setDraft(null)}
          onSaved={async () => {
            await load();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function EmployeeModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Employee;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [d, setD] = useState<Employee>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docKind, setDocKind] = useState("W4");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Employee>(k: K, v: Employee[K]) => setD((cur) => ({ ...cur, [k]: v }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { id, documents, ...rest } = d;
      void documents;
      const body = JSON.stringify({
        ...rest,
        hireDate: d.hireDate ? d.hireDate.slice(0, 10) : null,
      });
      if (id) {
        const r = await api<{ employee: Employee }>(`/api/payroll/employees/${id}`, {
          method: "PATCH",
          body,
        });
        setD(r.employee);
      } else {
        const r = await api<{ employee: Employee }>("/api/payroll/employees", { method: "POST", body });
        setD(r.employee);
      }
      await onSaved();
    } catch (e) {
      setError(describeApiError(e, "Could not save"));
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File) {
    if (!d.id) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", docKind);
      const res = await fetch(`/api/payroll/employees/${d.id}/documents`, { method: "POST", body: form });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Upload failed");
      setD((cur) => ({ ...cur, documents: [j.document, ...cur.documents] }));
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function openDoc(id: string) {
    try {
      const r = await api<{ url: string }>(`/api/payroll/documents/${id}`);
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not open");
    }
  }

  async function removeDoc(id: string) {
    if (!confirm("Delete this document?")) return;
    try {
      await api(`/api/payroll/documents/${id}`, { method: "DELETE" });
      setD((cur) => ({ ...cur, documents: cur.documents.filter((x) => x.id !== id) }));
      await onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete");
    }
  }

  async function remove() {
    if (!d.id || !confirm(`Delete ${d.firstName} ${d.lastName}? This can't be undone.`)) return;
    try {
      await api(`/api/payroll/employees/${d.id}`, { method: "DELETE" });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete");
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="card my-8 w-full max-w-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-semibold">{d.id ? "Edit employee" : "Add employee"}</h2>
        {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <h3 className="mb-2 text-sm font-semibold text-zinc-700">Personal</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name *">
            <input className="input" value={d.firstName} onChange={(e) => set("firstName", e.target.value)} />
          </Field>
          <Field label="Last name *">
            <input className="input" value={d.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
          <Field label="Email">
            <input className="input" value={d.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className="input" value={d.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Street">
            <input className="input" value={d.street} onChange={(e) => set("street", e.target.value)} />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="City">
              <input className="input" value={d.city} onChange={(e) => set("city", e.target.value)} />
            </Field>
            <Field label="State">
              <input
                className="input uppercase"
                maxLength={2}
                value={d.state}
                onChange={(e) => set("state", e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Zip">
              <input className="input" value={d.zip} onChange={(e) => set("zip", e.target.value)} />
            </Field>
          </div>
          <Field label="SSN — last 4 digits only">
            <input
              className="input"
              inputMode="numeric"
              maxLength={4}
              value={d.ssnLast4}
              onChange={(e) => set("ssnLast4", e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field label="Hire date">
            <input
              type="date"
              className="input"
              value={d.hireDate ? d.hireDate.slice(0, 10) : ""}
              onChange={(e) => set("hireDate", e.target.value || null)}
            />
          </Field>
        </div>

        <h3 className="mb-2 mt-5 text-sm font-semibold text-zinc-700">Pay</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Pay type">
            <select
              className="input"
              value={d.payType}
              onChange={(e) => set("payType", e.target.value as Employee["payType"])}
            >
              <option value="HOURLY">Hourly</option>
              <option value="SALARY">Salary</option>
            </select>
          </Field>
          {d.payType === "HOURLY" ? (
            <Field label="Hourly rate">
              <MoneyInput cents={d.hourlyRateCents} onCentsChange={(c) => set("hourlyRateCents", c)} />
            </Field>
          ) : (
            <Field label="Annual salary">
              <MoneyInput cents={d.annualSalaryCents} onCentsChange={(c) => set("annualSalaryCents", c)} />
            </Field>
          )}
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={d.active} onChange={(e) => set("active", e.target.checked)} />
            Active
          </label>
        </div>

        <h3 className="mb-1 mt-5 text-sm font-semibold text-zinc-700">Form W-4 (federal withholding)</h3>
        <p className="mb-2 text-[11px] text-zinc-400">
          Copy these from the employee&rsquo;s signed W-4 (2020 or later). Tennessee has no state income
          tax, so only federal tax is withheld.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Step 1(c) — filing status">
            <select
              className="input"
              value={d.filingStatus}
              onChange={(e) => set("filingStatus", e.target.value as Employee["filingStatus"])}
            >
              <option value="SINGLE">Single or married filing separately</option>
              <option value="MFJ">Married filing jointly</option>
              <option value="HOH">Head of household</option>
            </select>
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={d.w4Step2Checked}
              onChange={(e) => set("w4Step2Checked", e.target.checked)}
            />
            Step 2(c) box checked (two jobs)
          </label>
          <Field label="Step 3 — dependents/credits (per year)">
            <MoneyInput cents={d.w4CreditsCents} onCentsChange={(c) => set("w4CreditsCents", c)} />
          </Field>
          <Field label="Step 4(a) — other income (per year)">
            <MoneyInput cents={d.w4OtherIncomeCents} onCentsChange={(c) => set("w4OtherIncomeCents", c)} />
          </Field>
          <Field label="Step 4(b) — deductions (per year)">
            <MoneyInput cents={d.w4DeductionsCents} onCentsChange={(c) => set("w4DeductionsCents", c)} />
          </Field>
          <Field label="Step 4(c) — extra withholding (per paycheck)">
            <MoneyInput
              cents={d.w4ExtraWithholdingCents}
              onCentsChange={(c) => set("w4ExtraWithholdingCents", c)}
            />
          </Field>
        </div>

        <Field label="Notes" className="mt-3">
          <input className="input" value={d.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>

        <h3 className="mb-1 mt-5 text-sm font-semibold text-zinc-700">Documents</h3>
        {!d.id ? (
          <p className="text-xs text-zinc-400">Save the employee first, then attach their documents here.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select className="input h-9 w-auto" value={docKind} onChange={(e) => setDocKind(e.target.value)}>
                <option value="W4">W-4</option>
                <option value="I9">I-9</option>
                <option value="W9">W-9 (contractor)</option>
                <option value="ID">ID / driver license</option>
                <option value="OTHER">Other</option>
              </select>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                disabled={uploading}
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                className="text-sm"
              />
              {uploading && <span className="text-xs text-zinc-400">Uploading…</span>}
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {d.documents.length === 0 && <li className="text-xs text-zinc-400">No documents attached.</li>}
              {d.documents.map((doc) => (
                <li key={doc.id} className="flex items-center gap-2">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium">
                    {KIND_LABEL[doc.kind] ?? doc.kind}
                  </span>
                  <button className="text-indigo-600 underline" onClick={() => openDoc(doc.id)}>
                    {doc.fileName}
                  </button>
                  <button className="ml-auto text-xs text-red-500" onClick={() => removeDoc(doc.id)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-zinc-400">PDF, PNG, JPG or WEBP, up to 10 MB. Stored privately.</p>
          </>
        )}

        <div className="mt-5 flex items-center gap-2">
          {d.id && (
            <button className="btn-ghost text-xs text-red-500" onClick={remove}>
              Delete
            </button>
          )}
          <button className="btn-secondary ml-auto" onClick={onClose}>
            Close
          </button>
          <button
            className="btn-primary"
            onClick={save}
            disabled={saving || !d.firstName.trim() || !d.lastName.trim()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
