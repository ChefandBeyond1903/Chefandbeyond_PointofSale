/** Just the digits of a phone string — for storing/searching without () or -. */
export function phoneDigits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

/**
 * Format a US-style phone number for display / entry: (615)870-4844.
 * A leading "1" country code is dropped. Anything that isn't a 10-digit US
 * number is shown as far as it goes (partial while typing) or left as the raw
 * digits (e.g. an international number).
 */
export function formatPhone(s: string | null | undefined): string {
  let d = phoneDigits(s);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (!d) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)})${d.slice(3)}`;
  if (d.length <= 10) return `(${d.slice(0, 3)})${d.slice(3, 6)}-${d.slice(6)}`;
  // Longer than a US number — keep the first 10 formatted, append the rest.
  return `(${d.slice(0, 3)})${d.slice(3, 6)}-${d.slice(6, 10)} ${d.slice(10)}`.trim();
}
