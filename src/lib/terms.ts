/** Payment terms offered on a bill, and how each maps to a due date. */
export const BILL_TERMS = [
  "Due on receipt",
  "Net 15",
  "Net 30",
  "Net 45",
  "Net 60",
  "Custom",
] as const;

export type BillTerm = (typeof BILL_TERMS)[number] | "";

/**
 * Due date implied by `terms` counted from `billDate`. Returns null for
 * "Custom" / unset terms (the user picks the date by hand).
 */
export function dueDateFromTerms(billDate: Date, terms: string): Date | null {
  const d = new Date(billDate);
  switch (terms) {
    case "Due on receipt":
      return d;
    case "Net 15":
      d.setDate(d.getDate() + 15);
      return d;
    case "Net 30":
      d.setDate(d.getDate() + 30);
      return d;
    case "Net 45":
      d.setDate(d.getDate() + 45);
      return d;
    case "Net 60":
      d.setDate(d.getDate() + 60);
      return d;
    default:
      return null;
  }
}
