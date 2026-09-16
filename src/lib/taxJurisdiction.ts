// KY/TN delivery-based sales tax. Chef and Beyond's Guthrie, KY store sits
// right on the Kentucky/Tennessee line and regularly delivers into Tennessee;
// state law taxes a sale where possession transfers — pickup in KY is taxed
// at Kentucky's rate, but a seller delivery into Tennessee owes Tennessee's
// rate instead, overriding the store's own location. Shared by the register,
// the sales API, and the tax-by-state report so the two rates only live here.
export const TAX_JURISDICTIONS = {
  KY: { code: "KY", label: "Kentucky", rateBps: 600 },
  TN: { code: "TN", label: "Tennessee", rateBps: 975 },
} as const;

export type TaxJurisdictionCode = keyof typeof TAX_JURISDICTIONS;

export function isTaxJurisdictionCode(v: unknown): v is TaxJurisdictionCode {
  return v === "KY" || v === "TN";
}

// A store only participates in KY/TN delivery-switching when its configured
// tax rate exactly matches one of the two profiles — every other store (0%,
// or a custom rate) keeps today's flat single-rate behavior untouched.
export function storeHomeJurisdiction(
  taxRateBps: number | null | undefined,
): TaxJurisdictionCode | null {
  if (taxRateBps === TAX_JURISDICTIONS.KY.rateBps) return "KY";
  if (taxRateBps === TAX_JURISDICTIONS.TN.rateBps) return "TN";
  return null;
}

export function jurisdictionRateBps(code: TaxJurisdictionCode): number {
  return TAX_JURISDICTIONS[code].rateBps;
}

export function jurisdictionLabel(code: TaxJurisdictionCode | null | undefined): string {
  return code ? TAX_JURISDICTIONS[code].label : "";
}

// Best-effort read of the destination state out of a free-text delivery
// address ("... Clarksville, TN 37040" / "... Guthrie, Kentucky 42234").
// Returns null when the address doesn't clearly name one of the two states,
// so the caller can fall back to the store's home jurisdiction — matching the
// "default tax = Kentucky" requirement rather than guessing.
export function detectStateFromAddress(address: string): TaxJurisdictionCode | null {
  const a = address.toUpperCase();
  const tn = /\bTN\b/.test(a) || /TENNESSEE/.test(a);
  const ky = /\bKY\b/.test(a) || /KENTUCKY/.test(a);
  if (tn && !ky) return "TN";
  if (ky && !tn) return "KY";
  return null;
}

// The jurisdiction the POS auto-selects before any manual override: pickup
// keeps the store's home jurisdiction; a delivery is taxed where the address
// says possession transfers, falling back to home when that can't be read.
export function autoJurisdiction(
  homeJurisdiction: TaxJurisdictionCode | null,
  deliveryMethod: "PICKUP" | "DELIVERY",
  deliveryAddress: string,
): TaxJurisdictionCode | null {
  if (!homeJurisdiction) return null;
  if (deliveryMethod !== "DELIVERY") return homeJurisdiction;
  return detectStateFromAddress(deliveryAddress) ?? homeJurisdiction;
}
