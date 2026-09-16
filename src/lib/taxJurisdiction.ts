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

// The delivery address's state field is a dropdown of these two, plus an
// "Other" option (free-text 2-letter code) for a state this store doesn't
// have a tax profile for yet — kept for the record, but taxed at the store's
// home jurisdiction until a real profile is added for it.
export const DELIVERY_STATE_OPTIONS = [
  { code: "KY", label: "Kentucky" },
  { code: "TN", label: "Tennessee" },
] as const;

// A delivery address's state maps deterministically to a jurisdiction — no
// guessing from free text. Anything other than KY/TN (a state this store has
// no profile for) returns null.
export function stateToJurisdiction(stateCode: string): TaxJurisdictionCode | null {
  const c = stateCode.trim().toUpperCase();
  if (c === "KY") return "KY";
  if (c === "TN") return "TN";
  return null;
}

// The jurisdiction the POS auto-selects before any manual override: pickup
// keeps the store's home jurisdiction; a delivery is taxed where the chosen
// delivery state says possession transfers, falling back to home for a state
// with no tax profile — matching the "default tax = Kentucky" requirement.
export function autoJurisdiction(
  homeJurisdiction: TaxJurisdictionCode | null,
  deliveryMethod: "PICKUP" | "DELIVERY",
  deliveryState: string,
): TaxJurisdictionCode | null {
  if (!homeJurisdiction) return null;
  if (deliveryMethod !== "DELIVERY") return homeJurisdiction;
  return stateToJurisdiction(deliveryState) ?? homeJurisdiction;
}
