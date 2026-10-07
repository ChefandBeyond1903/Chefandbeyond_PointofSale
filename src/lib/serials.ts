// A line's serialNumber is stored as one comma-separated string (no schema
// change needed) but edited as one input per unit when quantity > 1, so
// selling 2 of the same serialized item takes 2 serial numbers, not one.

/** Splits the stored string into exactly `quantity` slots (padding/truncating). */
export function splitSerials(serialNumber: string, quantity: number): string[] {
  const n = Math.max(1, quantity);
  const out = serialNumber
    .split(",")
    .map((s) => s.trim())
    .slice(0, n);
  while (out.length < n) out.push("");
  return out;
}

/** Joins per-unit entries back into the single stored string, dropping blanks. */
export function joinSerials(parts: string[]): string {
  return parts.map((s) => s.trim()).filter(Boolean).join(", ");
}

// Categories whose products are never individually serialized — no serial #
// entry for anything in one of these. Anything else (including no category
// at all) still asks, since most products do carry a real serial.
const NO_SERIAL_CATEGORIES = ["smallwares", "work tables & sinks"];

export function tracksSerials(categoryName: string | null | undefined): boolean {
  const name = categoryName?.trim().toLowerCase();
  return !name || !NO_SERIAL_CATEGORIES.includes(name);
}
