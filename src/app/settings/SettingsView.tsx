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

export function SettingsView({ isAdmin = false }: { isAdmin?: boolean }) {
  return (
    <div className="w-full flex-1 space-y-6 p-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      {isAdmin && <CompanyCard />}
      <StoresCard isAdmin={isAdmin} />
      <PaymentMethodsCard />
      <CardReadersCard isAdmin={isAdmin} />
    </div>
  );
}

/* --------------------------- Payment methods --------------------------- */

function PaymentMethodsCard() {
  const [methods, setMethods] = useState<{ id: string; code: string; label: string }[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ methods: { id: string; code: string; label: string }[] }>("/api/payment-methods")
      .then((r) => setMethods(r.methods))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/payment-methods", { method: "POST", body: JSON.stringify({ label: label.trim() }) });
      setLabel("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the payment method");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Remove "${name}" as a payment option? Past sales keep it.`)) return;
    try {
      await api(`/api/payment-methods/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove it");
    }
  }

  return (
    <div className="card p-5">
      <h2 className="mb-1 text-lg font-semibold">Payment methods</h2>
      <p className="mb-4 text-sm text-zinc-500">
        Cash, Card, Check and Store credit are always available. Add others staff can pick — Zelle,
        Venmo, a wire — recorded as plain payment (no card fee).
      </p>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <ul className="mb-4 divide-y divide-zinc-100 text-sm">
        <li className="flex items-center justify-between py-2 text-zinc-400">
          <span>Cash · Card · Check · Store credit</span>
          <span className="text-xs">built in</span>
        </li>
        {methods.map((m) => (
          <li key={m.id} className="flex items-center justify-between py-2">
            <span className="font-medium">{m.label}</span>
            <button onClick={() => remove(m.id, m.label)} className="btn-ghost text-xs text-red-500">
              Remove
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="New payment method (e.g. Zelle)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="submit" disabled={busy || !label.trim()} className="btn-primary">
          {busy ? "Adding…" : "Add"}
        </button>
      </form>
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

function StoresCard({ isAdmin }: { isAdmin: boolean }) {
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
      const [r, me] = await Promise.all([
        api<{ stores: Store[] }>("/api/stores?all=1"),
        isAdmin
          ? Promise.resolve({ user: null as { storeId?: string | null } | null })
          : api<{ user: { storeId?: string | null } | null }>("/api/auth/me"),
      ]);
      const mine = me.user?.storeId ?? null;
      setStores(isAdmin ? r.stores : r.stores.filter((s) => s.id === mine));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load stores");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

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
    const body: Record<string, unknown> = {
      address: edit.address.trim(),
      phone: edit.phone.trim(),
      email: edit.email.trim(),
    };
    if (isAdmin) {
      body.name = edit.name.trim();
      body.taxRateBps = pctToBps(edit.taxRatePct);
    }
    await patch(editId, body);
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
        {isAdmin
          ? "Each store has its own sales-tax rate. A sale is taxed at the rate of the store its cashier is assigned to."
          : "Your store's contact details. Name and tax rate are set by an admin."}
      </p>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {isAdmin && (
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
            onChange={(e) =>
              setDraft({ ...draft, taxRatePct: e.target.value.replace(/[^0-9.]/g, "") })
            }
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
      )}

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
                        disabled={!isAdmin}
                        onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        className="input h-8 w-20 text-right"
                        inputMode="decimal"
                        value={edit.taxRatePct}
                        disabled={!isAdmin}
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
                      {isAdmin && (
                        <>
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
                        </>
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

// Stripe Terminal card readers. Pairing needs the code the reader shows on
// its screen after "Generate pairing code"; each store gets its own Stripe
// Location (created from the store address the first time).
function CardReadersCard({ isAdmin }: { isAdmin: boolean }) {
  type Reader = {
    id: string;
    storeId: string;
    storeName: string;
    label: string;
    deviceType: string;
    status: "online" | "offline" | "unknown";
  };
  const [readers, setReaders] = useState<Reader[]>([]);
  const [configured, setConfigured] = useState(true);
  const [testMode, setTestMode] = useState(false);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeId, setStoreId] = useState("");
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ readers: Reader[]; configured: boolean; testMode: boolean }>("/api/terminal/readers");
      setReaders(r.readers);
      setConfigured(r.configured);
      setTestMode(r.testMode);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load card readers");
    }
  }, []);
  useEffect(() => {
    api<{ readers: Reader[]; configured: boolean; testMode: boolean }>("/api/terminal/readers")
      .then((r) => {
        setReaders(r.readers);
        setConfigured(r.configured);
        setTestMode(r.testMode);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load card readers"));
    if (isAdmin) {
      api<{ stores: { id: string; name: string }[] }>("/api/stores")
        .then((r) => setStores(r.stores))
        .catch(() => {});
    }
  }, [isAdmin]);

  async function pair(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/terminal/readers", {
        method: "POST",
        body: JSON.stringify({ label, registrationCode: code, ...(isAdmin ? { storeId } : {}) }),
      });
      setLabel("");
      setCode("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not pair the reader");
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: Reader) {
    if (!confirm(`Remove "${r.label}"? It will need pairing again to take payments.`)) return;
    setError(null);
    try {
      await api(`/api/terminal/readers/${r.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not remove the reader");
    }
  }

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold">Card readers</h2>
      <p className="mb-4 text-sm text-zinc-500">
        Stripe card readers (WisePOS E / Reader S700) the register sends card payments to. On the
        reader, open Settings → Generate pairing code, then enter that code here.
        {testMode ? " Sandbox mode: the code \"simulated-wpe\" pairs a simulated reader." : ""}
      </p>

      {!configured && (
        <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Stripe isn&apos;t connected on this deployment yet, so readers can&apos;t be paired.
        </p>
      )}
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form onSubmit={pair} className="mb-5 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        {isAdmin ? (
          <select className="input" value={storeId} onChange={(e) => setStoreId(e.target.value)} required>
            <option value="">Store…</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <div />
        )}
        <input
          className="input"
          placeholder="Reader name (e.g. Front counter)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
        <input
          className="input"
          placeholder="Pairing code (e.g. sepia-cerulean-orynx)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <button className="btn-primary whitespace-nowrap" disabled={busy || !configured}>
          {busy ? "Pairing…" : "Pair reader"}
        </button>
      </form>

      {readers.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No readers paired. Until one is, the register asks the cashier to run cards on the
          standalone terminal and record them by hand.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-3">Reader</th>
                <th className="py-1 pr-3">Store</th>
                <th className="py-1 pr-3">Model</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {readers.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100">
                  <td className="py-2 pr-3 font-medium">{r.label}</td>
                  <td className="py-2 pr-3">{r.storeName}</td>
                  <td className="py-2 pr-3 text-zinc-500">{r.deviceType.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        r.status === "online" ? "bg-emerald-500" : r.status === "offline" ? "bg-red-500" : "bg-zinc-300"
                      }`}
                    />{" "}
                    {r.status}
                  </td>
                  <td className="py-2 text-right">
                    <button onClick={() => remove(r)} className="btn-ghost text-xs text-red-600">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
