// Payment methods. The built-in four carry behavior: CARD is charged a
// processing fee in the reports, CREDIT moves a customer's store-credit
// balance, CHECK asks for a check number, CASH tracks tendered/change.
// Anything else (Zelle, Venmo, wire, …) is added in Settings and treated as
// plain tender — money received, no fee, no balance effect.

export const BUILTIN_PAYMENT_METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "CARD", label: "Card" },
  { code: "CHECK", label: "Check" },
  { code: "CREDIT", label: "Store credit" },
] as const;

export const BUILTIN_METHOD_CODES = BUILTIN_PAYMENT_METHODS.map((m) => m.code);
// Reserved codes a custom method can't reuse.
export const RESERVED_METHOD_CODES = [...BUILTIN_METHOD_CODES, "SPLIT"];

export type PaymentMethodOption = { code: string; label: string };

/** A label -> code slug: uppercased, non-alphanumerics to underscores. */
export function methodCode(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Human label for a stored method code, given the custom list. */
export function methodLabel(code: string, custom: PaymentMethodOption[] = []): string {
  return (
    BUILTIN_PAYMENT_METHODS.find((m) => m.code === code)?.label ??
    custom.find((m) => m.code === code)?.label ??
    code
  );
}
