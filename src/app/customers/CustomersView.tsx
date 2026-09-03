"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import type { Customer } from "@/lib/types";

const TERMS = ["Net 15", "Net 30", "Net 45", "Net 60"] as const;

type Draft = {
  id?: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  address: string;
  notes: string;
  taxExempt: boolean;
  taxExemptCertNumber: string;
  taxExemptState: string;
  taxExemptExpiresAt: string; // yyyy-mm-dd or ""
  paymentTerms: string; // "" = due on receipt
  taxExemptDocName: string; // display only; managed by the upload endpoint
};

const emptyDraft: Draft = {
  name: "",
  email: "",
  phone: "",
  company: "",
  address: "",
  notes: "",
  taxExempt: false,
  taxExemptCertNumber: "",
  taxExemptState: "",
  taxExemptExpiresAt: "",
  paymentTerms: "",
  taxExemptDocName: "",
};

function certExpired(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d < new Date(new Date().toDateString());
}

export function CustomersView({ canManage = true }: { canManage?: boolean }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [docBusy, setDocBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ customers: Customer[] }>(
        `/api/customers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`,
      );
      setCustomers(res.customers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load customers");
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: draft.name,
      email: draft.email,
      phone: draft.phone,
      company: draft.company,
      address: draft.address,
      notes: draft.notes,
      taxExempt: draft.taxExempt,
      taxExemptCertNumber: draft.taxExemptCertNumber,
      taxExemptState: draft.taxExemptState,
      taxExemptExpiresAt: draft.taxExemptExpiresAt || null,
      paymentTerms: draft.paymentTerms,
    };
    try {
      if (draft.id) {
        await api(`/api/customers/${draft.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/customers", { method: "POST", body: JSON.stringify(payload) });
      }
      setDraft(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save customer");
    } finally {
      setSaving(false);
    }
  }

  async function uploadDoc(file: File) {
    if (!draft?.id) return;
    setDocBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/customers/${draft.id}/tax-exempt-doc`, {
        method: "POST",
        body: fd,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Upload failed");
      setDraft((d) => (d ? { ...d, taxExemptDocName: body.customer.taxExemptDocName } : d));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the certificate");
    } finally {
      setDocBusy(false);
    }
  }

  async function viewDoc() {
    if (!draft?.id) return;
    try {
      const { url } = await api<{ url: string }>(`/api/customers/${draft.id}/tax-exempt-doc`);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open the certificate");
    }
  }

  async function removeDoc() {
    if (!draft?.id || !confirm("Remove the uploaded certificate?")) return;
    setDocBusy(true);
    setError(null);
    try {
      await api(`/api/customers/${draft.id}/tax-exempt-doc`, { method: "DELETE" });
      setDraft((d) => (d ? { ...d, taxExemptDocName: "" } : d));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the certificate");
    } finally {
      setDocBusy(false);
    }
  }

  async function remove(c: Customer) {
    const warn =
      c._count && c._count.sales > 0
        ? `\n\n${c._count.sales} invoice(s) reference this customer — they keep the billing details, only the directory record is removed.`
        : "";
    if (!confirm(`Delete customer "${c.name}"?${warn}`)) return;
    try {
      await api(`/api/customers/${c.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete customer");
    }
  }

  return (
    <div className="w-full flex-1 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Customers</h1>
        <input
          className="input max-w-xs"
          placeholder="Search name, email, phone, company, address, notes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {canManage ? (
          <button onClick={() => setDraft({ ...emptyDraft })} className="btn-primary ml-auto">
            + New customer
          </button>
        ) : (
          <span className="ml-auto text-xs text-zinc-400">View only</span>
        )}
      </div>

      <p className="mb-3 text-xs text-zinc-400">
        Customers are added automatically the first time you invoice them on the register.
      </p>

      {error && !draft && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Company</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Phone</th>
              <th className="px-4 py-2.5 text-right">Invoices</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                  No customers{q.trim() ? " match your search" : " yet"}.
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 font-medium">
                    {c.name}
                    {c.taxExempt && (
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-normal ${
                          certExpired(c.taxExemptExpiresAt)
                            ? "bg-red-100 text-red-700"
                            : "bg-emerald-100 text-emerald-700"
                        }`}
                        title={
                          c.taxExemptExpiresAt
                            ? `Certificate ${certExpired(c.taxExemptExpiresAt) ? "expired" : "valid to"} ${new Date(
                                c.taxExemptExpiresAt,
                              ).toLocaleDateString()}`
                            : "Tax-exempt"
                        }
                      >
                        Tax-exempt{certExpired(c.taxExemptExpiresAt) ? " (expired)" : ""}
                      </span>
                    )}
                    {c.paymentTerms && (
                      <span className="ml-2 text-[11px] font-normal text-zinc-400">
                        {c.paymentTerms}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">{c.company || "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{c.email || "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{c.phone || "—"}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-500">{c._count?.sales ?? 0}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {canManage ? (
                      <>
                        <button
                          onClick={() =>
                            setDraft({
                              id: c.id,
                              name: c.name,
                              email: c.email,
                              phone: c.phone,
                              company: c.company,
                              address: c.address,
                              notes: c.notes,
                              taxExempt: c.taxExempt,
                              taxExemptCertNumber: c.taxExemptCertNumber ?? "",
                              taxExemptState: c.taxExemptState ?? "",
                              taxExemptExpiresAt: c.taxExemptExpiresAt
                                ? c.taxExemptExpiresAt.slice(0, 10)
                                : "",
                              paymentTerms: c.paymentTerms ?? "",
                              taxExemptDocName: c.taxExemptDocName ?? "",
                            })
                          }
                          className="btn-ghost text-xs"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => remove(c)}
                          className="btn-ghost text-xs text-red-500"
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-zinc-300">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setDraft(null)}
        >
          <div
            className="card max-h-[90vh] w-full max-w-md overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold">
              {draft.id ? "Edit customer" : "New customer"}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="label">Name</label>
                <input
                  className="input"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Company</label>
                  <input
                    className="input"
                    value={draft.company}
                    onChange={(e) => setDraft({ ...draft, company: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input
                    className="input"
                    value={draft.phone}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  className="input"
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Address</label>
                <textarea
                  className="input"
                  rows={2}
                  value={draft.address}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input"
                  rows={2}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Payment terms</label>
                <select
                  className="input"
                  value={draft.paymentTerms}
                  onChange={(e) => setDraft({ ...draft, paymentTerms: e.target.value })}
                >
                  <option value="">Due on receipt (no due date)</option>
                  {TERMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  Invoices for this customer get a due date of the sale date plus the term.
                </p>
              </div>

              <div className="rounded-md border border-zinc-200 p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={draft.taxExempt}
                    onChange={(e) => setDraft({ ...draft, taxExempt: e.target.checked })}
                  />
                  Sales-tax exempt
                </label>
                {draft.taxExempt && (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Certificate no.</label>
                        <input
                          className="input"
                          value={draft.taxExemptCertNumber}
                          onChange={(e) =>
                            setDraft({ ...draft, taxExemptCertNumber: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label className="label">Issuing state</label>
                        <input
                          className="input"
                          placeholder="e.g. TN"
                          value={draft.taxExemptState}
                          onChange={(e) => setDraft({ ...draft, taxExemptState: e.target.value })}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="label">Expires</label>
                      <input
                        type="date"
                        className="input"
                        value={draft.taxExemptExpiresAt}
                        onChange={(e) =>
                          setDraft({ ...draft, taxExemptExpiresAt: e.target.value })
                        }
                      />
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        After this date, sales to this customer are taxed again. Leave blank for
                        no expiry.
                      </p>
                    </div>
                    <div>
                      <label className="label">Exemption certificate</label>
                      {!draft.id ? (
                        <p className="text-[11px] text-zinc-400">
                          Save the customer first, then re-open to attach the certificate file.
                        </p>
                      ) : draft.taxExemptDocName ? (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="truncate text-zinc-600">📄 {draft.taxExemptDocName}</span>
                          <button
                            type="button"
                            onClick={viewDoc}
                            className="btn-ghost h-7 px-2 text-xs text-indigo-600"
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={removeDoc}
                            disabled={docBusy}
                            className="btn-ghost h-7 px-2 text-xs text-red-500"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
                            disabled={docBusy}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadDoc(f);
                              e.target.value = "";
                            }}
                            className="text-xs"
                          />
                          {docBusy && <span className="text-xs text-zinc-400">Uploading…</span>}
                        </div>
                      )}
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        PDF, PNG, JPG or WEBP, up to 10 MB. Stored privately.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="mt-5 flex gap-2">
              <button onClick={() => setDraft(null)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !draft.name.trim()}
                className="btn-primary flex-1"
              >
                {saving ? "Saving…" : "Save customer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
