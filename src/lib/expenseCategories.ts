// Ready-made operating-expense categories. A manager can add more at runtime
// (stored in the ExpenseCategory table); the picker shows both, merged.
export const PREBUILT_EXPENSE_CATEGORIES = [
  "Rent",
  "Electricity",
  "Water",
  "Gas",
  "Internet",
  "Phone",
  "Trash / Waste",
  "Insurance",
  "Payroll",
  "Payroll taxes",
  "Marketing / Advertising",
  "Office supplies",
  "Repairs & maintenance",
  "Vehicle / Fuel",
  "Software / Subscriptions",
  "Bank & merchant fees",
  "Professional fees",
  "Licenses & permits",
  "Travel",
  "Meals & entertainment",
  "Shipping & postage",
  "Cleaning",
  "Security",
  "Equipment rental",
  "Property taxes",
  "Miscellaneous",
] as const;

/** Prebuilt list plus any custom names, de-duplicated (case-insensitive) and sorted. */
export function mergeExpenseCategories(custom: string[]): string[] {
  const seen = new Map<string, string>();
  for (const name of [...PREBUILT_EXPENSE_CATEGORIES, ...custom]) {
    const key = name.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, name.trim());
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
