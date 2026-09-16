"use client";

import { STATE_OPTIONS } from "@/lib/address";

// Maps a stored 2-letter state code onto the dropdown: KY/TN select
// themselves, anything else falls into "Add state…" with the code shown in
// its free-text field, "" leaves the dropdown unset.
export function stateToDraft(state?: string | null): { state: string; stateOther: string } {
  const s = (state ?? "").trim().toUpperCase();
  if (!s) return { state: "", stateOther: "" };
  if (STATE_OPTIONS.some((o) => o.code === s)) return { state: s, stateOther: "" };
  return { state: "OTHER", stateOther: s };
}

// The address's actual 2-letter code to send to the server: the dropdown
// value, or its free-text field when "Add state…" is selected.
export function resolveState(state: string, stateOther: string): string {
  return state === "OTHER" ? stateOther.trim().toUpperCase() : state;
}

// Street / city / state (KY, TN, or a free-text "Add state…") / zip — the
// standard address entry used for a customer's billing address, each of
// their ship-to locations, and the register's delivery address.
export function AddressFields({
  street,
  city,
  state,
  stateOther,
  zip,
  onStreet,
  onCity,
  onState,
  onStateOther,
  onZip,
}: {
  street: string;
  city: string;
  state: string;
  stateOther: string;
  zip: string;
  onStreet: (v: string) => void;
  onCity: (v: string) => void;
  onState: (v: string) => void;
  onStateOther: (v: string) => void;
  onZip: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <input
        className="input h-8"
        placeholder="Street address"
        value={street}
        onChange={(e) => onStreet(e.target.value)}
      />
      <div className="flex gap-1.5">
        <input
          className="input h-8 min-w-0 flex-1"
          placeholder="City"
          value={city}
          onChange={(e) => onCity(e.target.value)}
        />
        <select className="input h-8 w-32" value={state} onChange={(e) => onState(e.target.value)}>
          <option value="">State…</option>
          {STATE_OPTIONS.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code}
            </option>
          ))}
          <option value="OTHER">Add state…</option>
        </select>
        <input
          className="input h-8 w-24"
          placeholder="ZIP"
          value={zip}
          onChange={(e) => onZip(e.target.value)}
        />
      </div>
      {state === "OTHER" && (
        <input
          className="input h-8 w-32"
          placeholder="State (2-letter)"
          maxLength={2}
          value={stateOther}
          onChange={(e) => onStateOther(e.target.value.toUpperCase())}
        />
      )}
    </div>
  );
}
