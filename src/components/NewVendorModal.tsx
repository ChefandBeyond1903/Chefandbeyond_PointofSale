"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client";
import { MoneyInput } from "@/components/MoneyInput";
import type { Vendor } from "@/lib/types";

type Draft = {
  name: string;
  contact: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  freightMinimumCents: number;
  rebatePct: string;
};

const emptyDraft: Draft = {
  name: "",
  contact: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  freightMinimumCents: 0,
  rebatePct: "",
};

/**
 * Add a vendor to the directory without leaving the page it was needed from
 * (e.g. the purchase-order form) — the exact same fields as "+ New vendor"
 * under Vendors, so nothing has to be filled in later over there.
 */
export function NewVendorModal({
  initialName = "",
  onClose,
  onCreated,
}: {
  initialName?: string;
  onClose: () => void;
  onCreated: (vendor: Vendor) => void;
}) {
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft, name: initialName });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!draft.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { vendor } = await api<{ vendor: Vendor }>("/api/vendors", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name.trim(),
          contact: draft.contact.trim(),
          email: draft.email.trim(),
          phone: draft.phone.trim(),
          address: draft.address.trim(),
          notes: draft.notes.trim(),
          freightMinimumCents: draft.freightMinimumCents,
          rebateBps: Math.round((parseFloat(draft.rebatePct) || 0) * 100),
        }),
      });
      onCreated(vendor);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save vendor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card max-h-[90vh] w-full max-w-md overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold">New vendor</h2>
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
          <div className="grid grid-cols-2 gap-3">
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
              <label className="label">Rebate %</label>
              <input
                className="input"
                inputMode="decimal"
                placeholder="0"
                value={draft.rebatePct}
                onChange={(e) =>
                  setDraft({ ...draft, rebatePct: e.target.value.replace(/[^0-9.]/g, "") })
                }
              />
              <p className="mt-0.5 text-[11px] text-zinc-400">
                Rebate this vendor pays back, e.g. 2.5 for 2.5%. Shown on Reports &gt; Sales by
                vendor.
              </p>
            </div>
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
          <button onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button onClick={save} disabled={saving || !draft.name.trim()} className="btn-primary flex-1">
            {saving ? "Saving…" : "Save vendor"}
          </button>
        </div>
      </div>
    </div>
  );
}
