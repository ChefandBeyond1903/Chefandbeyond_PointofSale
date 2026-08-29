"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatBps } from "@/lib/money";
import type { Company, Store } from "@/lib/types";

const EMPTY_COMPANY: Company = {
  name: "",
  legalName: "",
  taxId: "",
  address: "",
  phone: "",
  email: "",
  website: "",
};

export function SettingsView() {
  return (
    <div className="w-full flex-1 space-y-6 p-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <CompanyCard />
      <StoresCard />
    </div>
  );
}

/* ------------------------------- Company ------------------------------- */

function CompanyCard() {
  const [form, setForm] = useState<Company>(EMPTY_COMPANY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<{ company: Company }>("/api/company")
      .then((r) => setForm({ ...EMPTY_COMPANY, ...r.company }))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load company"))
      .finally(() => setLoading(false));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api("/api/company", { method: "PUT", body: JSON.stringify(form) });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof Company) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      setSaved(false);
    },
  });

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold">Company</h2>
      <p className="mb-4 text-sm text-zinc-500">
        Shown on receipts and invoices. One record for the whole business.
      </p>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Business name</label>
            <input className="input" placeholder="Chef and Beyond" {...field("name")} />
          </div>
          <div>
            <label className="label">Legal name</label>
            <input className="input" {...field("legalName")} />
          </div>
          <div>
            <label className="label">Tax ID / EIN</label>
            <input className="input" {...field("taxId")} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" {...field("phone")} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" {...field("email")} />
          </div>
          <div>
            <label className="label">Website</label>
            <input className="input" {...field("website")} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Address</label>
            <input className="input" {...field("address")} />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save company"}
            </button>
            {saved && <span className="text-sm text-green-600">Saved</span>}
          </div>
        </form>
      )}
    </section>
  );
}

/* -------------------------------- Stores -------------------------------- */

type StoreDraft = {
  name: string;
  taxRatePct: string;
  address: string;
  phone: string;
  email: string;
};

const EMPTY_STORE: StoreDraft = { name: "", taxRatePct: "", address: "", phone: "", email: "" };

function pctToBps(pct: string): number {
  const n = parseFloat(pct || "0");
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function StoresCard() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<StoreDraft>(EMPTY_STORE);
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<StoreDraft>(EMPTY_STORE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ stores: Store[] }>("/api/stores?all=1");
      setStores(r.stores);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load stores");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await api("/api/stores", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name.trim(),
          taxRateBps: pctToBps(draft.taxRatePct),
          address: draft.address.trim(),
          phone: draft.phone.trim(),
          email: draft.email.trim(),
        }),
      });
      setDraft(EMPTY_STORE);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add store");
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await api(`/api/stores/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  function startEdit(s: Store) {
    setEditId(s.id);
    setEdit({
      name: s.name,
      taxRatePct: (s.taxRateBps / 100).toString(),
      address: s.address,
      phone: s.phone,
      email: s.email,
    });
  }

  async function saveEdit() {
    if (!editId) return;
    await patch(editId, {
      name: edit.name.trim(),
      taxRateBps: pctToBps(edit.taxRatePct),
      address: edit.address.trim(),
      phone: edit.phone.trim(),
      email: edit.email.trim(),
    });
    setEditId(null);
  }

  async function remove(s: Store) {
    if (!confirm(`Delete "${s.name}"? This only works if it has no staff or sales.`)) return;
    setError(null);
    try {
      await api(`/api/stores/${s.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete");
    }
  }

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold">Stores</h2>
      <p className="mb-4 text-sm text-zinc-500">
        Each store has its own sales-tax rate. A sale is taxed at the rate of the store its cashier
        is assigned to.
      </p>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form onSubmit={create} className="mb-5 grid gap-2 sm:grid-cols-[1.4fr_0.6fr_1.4fr_1fr_auto]">
        <input
          className="input"
          placeholder="Store name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          required
        />
        <input
          className="input"
          inputMode="decimal"
          placeholder="Tax %"
          value={draft.taxRatePct}
          onChange={(e) => setDraft({ ...draft, taxRatePct: e.target.value.replace(/[^0-9.]/g, "") })}
          required
        />
        <input
          className="input"
          placeholder="Address"
          value={draft.address}
          onChange={(e) => setDraft({ ...draft, address: e.target.value })}
        />
        <input
          className="input"
          placeholder="Phone"
          value={draft.phone}
          onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
        />
        <button className="btn-primary whitespace-nowrap" disabled={creating}>
          Add store
        </button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
            <tr>
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3 text-right">Tax</th>
              <th className="py-2 pr-3">Address</th>
              <th className="py-2 pr-3">Phone</th>
              <th className="py-2 pr-3 text-right">Staff</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : stores.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-zinc-400">
                  No stores yet.
                </td>
              </tr>
            ) : (
              stores.map((s) =>
                editId === s.id ? (
                  <tr key={s.id} className="bg-zinc-50">
                    <td className="py-2 pr-3">
                      <input
                        className="input h-8"
                        value={edit.name}
                        onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        className="input h-8 w-20 text-right"
                        inputMode="decimal"
                        value={edit.taxRatePct}
                        onChange={(e) =>
                          setEdit({ ...edit, taxRatePct: e.target.value.replace(/[^0-9.]/g, "") })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        className="input h-8"
                        value={edit.address}
                        onChange={(e) => setEdit({ ...edit, address: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        className="input h-8"
                        value={edit.phone}
                        onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right text-zinc-400">
                      {s._count?.users ?? 0}
                    </td>
                    <td className="py-2 pr-3 text-zinc-400">
                      {s.active ? "Active" : "Inactive"}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button onClick={saveEdit} className="btn-ghost text-xs text-indigo-600">
                        Save
                      </button>
                      <button onClick={() => setEditId(null)} className="btn-ghost text-xs">
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id} className={s.active ? "" : "opacity-50"}>
                    <td className="py-2 pr-3 font-medium">{s.name}</td>
                    <td className="py-2 pr-3 text-right">{formatBps(s.taxRateBps)}</td>
                    <td className="py-2 pr-3 text-zinc-500">{s.address || "—"}</td>
                    <td className="py-2 pr-3 text-zinc-500">{s.phone || "—"}</td>
                    <td className="py-2 pr-3 text-right text-zinc-500">{s._count?.users ?? 0}</td>
                    <td className="py-2 pr-3">
                      {s.active ? (
                        <span className="text-green-600">Active</span>
                      ) : (
                        <span className="text-zinc-400">Inactive</span>
                      )}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button onClick={() => startEdit(s)} className="btn-ghost text-xs">
                        Edit
                      </button>
                      <button
                        onClick={() => patch(s.id, { active: !s.active })}
                        className="btn-ghost text-xs"
                      >
                        {s.active ? "Deactivate" : "Reactivate"}
                      </button>
                      {(s._count?.users ?? 0) === 0 && (s._count?.sales ?? 0) === 0 && (
                        <button
                          onClick={() => remove(s)}
                          className="btn-ghost text-xs text-red-500"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
