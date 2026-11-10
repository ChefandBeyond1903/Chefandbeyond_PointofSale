// Structured street/city/state/zip, used everywhere the app collects a
// mailing address (customers, customer locations, register delivery).

// The state dropdown offered wherever an address is entered: Kentucky and
// Tennessee (the two states this business operates in and has a tax profile
// for — see taxJurisdiction.ts), plus room to name a third with "Add state…".
export const STATE_OPTIONS = [
  { code: "KY", label: "Kentucky" },
  { code: "TN", label: "Tennessee" },
] as const;

export interface StructuredAddress {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

// Single-line address for anything that still just displays or snapshots a
// plain string (invoices, receipts, search, the old free-text field) —
// composed from the structured fields, which are the source of truth.
export function formatAddress(a: StructuredAddress): string {
  const cityState = [a.city?.trim(), a.state?.trim()].filter(Boolean).join(", ");
  const cityStateZip = [cityState, a.zip?.trim()].filter(Boolean).join(" ");
  return [a.street?.trim(), cityStateZip].filter(Boolean).join(", ");
}

/**
 * Best-effort split of a one-line address ("1010 Foster Ave, Nashville, TN 37210")
 * into structured fields. Anything that doesn't parse cleanly lands whole in
 * `street`, so the composed one-line address always round-trips unchanged.
 */
export function parseOneLineAddress(raw: string): Required<StructuredAddress> {
  const text = raw.trim();
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  const tail = parts[parts.length - 1] ?? "";
  const m = tail.match(/^([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/);
  if (m && parts.length >= 3) {
    return { street: parts.slice(0, -2).join(", "), city: parts[parts.length - 2], state: m[1].toUpperCase(), zip: m[2] };
  }
  return { street: text, city: "", state: "", zip: "" };
}
