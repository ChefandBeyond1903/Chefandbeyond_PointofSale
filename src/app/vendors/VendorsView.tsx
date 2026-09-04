"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { MoneyInput } from "@/components/MoneyInput";
import { matchesSearch } from "@/lib/search";
import { VendorHistoryModal } from "@/components/VendorHistoryModal";
import { usePaged } from "@/lib/usePaged";
import { Pager } from "@/components/Pager";
import { ListHeader, SearchBox } from "@/components/ListToolbar";
import { LoadingRow, EmptyRow } from "@/components/TableState";
import type { Vendor } from "@/lib/types";

type Draft = {
  id?: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  freightMinimumCents: number;
};

const emptyDraft: Draft = {
  name: "",
  contact: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  freightMinimumCents: 0,
};

export function VendorsView({ canManage = true }: { canManage?: boolean }) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [historyVendor, setHistoryVendor] = useState<Vendor | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim();
    if (!s) return vendors;
    return vendors.filter((v) =>
      matchesSearch(s, [v.name, v.contact, v.email, v.phone, v.address, v.notes]),
    );
  }, [vendors, q]);

  const pg = usePaged(filtered);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ vendors: Vendor[] }>("/api/vendors");
      setVendors(res.vendors);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load vendors");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: draft.name,
      contact: draft.contact,
      email: draft.email,
      phone: draft.phone,
      address: draft.address,
      notes: draft.notes,
      freightMinimumCents: draft.freightMinimumCents,
    };
    try {
      if (draft.id) {
        await api(`/api/vendors/${draft.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/vendors", { method: "POST", body: JSON.stringify(payload) });
      }
      setDraft(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save vendor");
    } finally {
      setSaving(false);
    }
  }

  async function remove(v: Vendor) {
    const warn =
      v.productCount && v.productCount > 0
        ? `\n\n${v.productCount} product(s) use this vendor name — they keep the name, only the contact record is removed.`
        : "";
    if (!confirm(`Delete vendor "${v.name}"?${warn}`)) return;
    try {
      await api(`/api/vendors/${v.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete vendor");
    }
  }

  return (
    <div className="w-full flex-1 p-4">
      <ListHeader title="Vendors">
        <SearchBox value={q} onChange={setQ} placeholder="Search vendors…" />
        {canManage ? (
          <button onClick={() => setDraft({ ...emptyDraft })} className="btn-primary ml-auto">
            + New vendor
          </button>
        ) : (
          <span className="ml-auto text-xs text-zinc-400">View only</span>
        )}
      </ListHeader>

      {error && !draft && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <Pager {...pg} className="mb-2 justify-end" />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Contact</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Phone</th>
              <th className="px-4 py-2.5 text-right">Free-freight min.</th>
              <th className="px-4 py-2.5 text-right">In stock</th>
              <th className="px-4 py-2.5 text-right">Products</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <LoadingRow colSpan={8} />
            ) : pg.total === 0 ? (
              <EmptyRow colSpan={8}>
                {vendors.length === 0
                  ? "No vendors yet. Add one to start."
                  : "No vendors match your search."}
              </EmptyRow>
            ) : (
              pg.pageItems.map((v) => (
                <tr key={v.id}>
                  <td className="px-4 py-2.5 font-medium">{v.name}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{v.contact || "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{v.email || "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{v.phone || "—"}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-500">
                    {v.freightMinimumCents > 0 ? formatMoney(v.freightMinimumCents) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium">
                    {v.inStockProductCount ?? 0}
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-400">{v.productCount ?? 0}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => setHistoryVendor(v)}
                      className="btn-ghost text-xs"
                    >
                      History
                    </button>
                    {canManage && (
                      <>
                        <button
                          onClick={() =>
                            setDraft({
                              id: v.id,
                              name: v.name,
                              contact: v.contact,
                              email: v.email,
                              phone: v.phone,
                              address: v.address,
                              notes: v.notes,
                              freightMinimumCents: v.freightMinimumCents,
                            })
                          }
                          className="btn-ghost text-xs"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => remove(v)}
                          className="btn-ghost text-xs text-red-500"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {historyVendor && (
        <VendorHistoryModal
          vendorName={historyVendor.name}
          onClose={() => setHistoryVendor(null)}
        />
      )}

      {draft && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setDraft(null)}
        >
          <div
            className="card max-h-[90vh] w-full max-w-md overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold">{draft.id ? "Edit vendor" : "New vendor"}</h2>
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
                  <label className="label">Contact person</label>
                  <input
                    className="input"
                    value={draft.contact}
                    onChange={(e) => setDraft({ ...draft, contact: e.target.value })}
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
                <label className="label">Free-freight minimum</label>
                <MoneyInput
                  cents={draft.freightMinimumCents}
                  onCentsChange={(c) => setDraft({ ...draft, freightMinimumCents: c })}
                />
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  Order total needed for free freight. Leave 0 if none — ordering below it only
                  warns, it never blocks the PO.
                </p>
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
            </div>

            {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="mt-5 flex gap-2">
              <button onClick={() => setDraft(null)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button onClick={save} disabled={saving || !draft.name.trim()} className="btn-primary flex-1">
                {saving ? "Saving…" : "Save vendor"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
