// The two buying groups purchases can be made through. A vendor can belong to
// both; each product says which group it's bought through (blank = the
// vendor's own group). Rebates are tracked separately per group.

export type BuyingGroup = "STRATA" | "USAFED";

export const BUYING_GROUP_LABEL: Record<BuyingGroup, string> = {
  STRATA: "Strata",
  USAFED: "USA-FED",
};

type VendorGroups = { strataBuyingGroup: boolean; usaFedBuyingGroup: boolean };
type VendorRates = { rebateBps: number; usaFedRebateBps: number };

/** The group a product is bought through: its own setting, else its vendor's. "" = no group. */
export function effectiveGroup(
  productGroup: string | null | undefined,
  vendor: VendorGroups | null | undefined,
): BuyingGroup | "" {
  if (productGroup === "STRATA" || productGroup === "USAFED") return productGroup;
  if (vendor?.strataBuyingGroup) return "STRATA";
  if (vendor?.usaFedBuyingGroup) return "USAFED";
  return "";
}

/** The vendor's rebate rate for a group (rebateBps is the Strata / non-group rate). */
export function rebateBpsFor(group: BuyingGroup | "", vendor: VendorRates | null | undefined): number {
  if (!vendor) return 0;
  return group === "USAFED" ? vendor.usaFedRebateBps : vendor.rebateBps;
}
