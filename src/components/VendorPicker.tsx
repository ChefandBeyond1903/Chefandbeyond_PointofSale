"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import type { Vendor } from "@/lib/types";

/**
 * Pick a vendor from the Vendors directory, with type-ahead. If what's typed
 * isn't an existing vendor, the dropdown offers "+ Add … as a new vendor",
 * which creates the directory record on the spot and selects it.
 */
export function VendorPicker({
  value,
  onChange,
  disabled = false,
  placeholder = "Vendor",
}: {
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () =>
    api<{ vendors: Vendor[] }>("/api/vendors")
      .then((r) => setVendors(r.vendors.map((v) => ({ id: v.id, name: v.name }))))
      .catch(() => {});

  useEffect(() => {
    refresh();
  }, []);

  const term = value.trim().toLowerCase();
  const matches = (
    term ? vendors.filter((v) => v.name.toLowerCase().includes(term)) : vendors
  ).slice(0, 20);
  const exact = vendors.some((v) => v.name.toLowerCase() === term);

  async function addNew() {
    const name = value.trim();
    if (!name) return;
    setAdding(true);
    setErr(null);
    try {
      await api("/api/vendors", { method: "POST", body: JSON.stringify({ name }) });
      await refresh();
      onChange(name);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add the vendor");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="relative">
      <input
        className="input"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && !disabled && (matches.length > 0 || (!!term && !exact)) && (
        <ul className="absolute z-40 mt-1 max-h-56 w-full overflow-auto rounded-md border border-zinc-200 bg-white text-sm shadow-lg">
          {matches.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(v.name);
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-indigo-50"
              >
                {v.name}
              </button>
            </li>
          ))}
          {!!term && !exact && (
            <li className="border-t border-zinc-100">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addNew();
                }}
                disabled={adding}
                className="block w-full px-3 py-1.5 text-left font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
              >
                {adding ? "Adding…" : `+ Add “${value.trim()}” as a new vendor`}
              </button>
            </li>
          )}
        </ul>
      )}
      {err && <p className="mt-1 text-[11px] text-red-600">{err}</p>}
    </div>
  );
}
