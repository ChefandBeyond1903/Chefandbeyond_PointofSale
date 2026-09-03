/**
 * Calendar-date handling for values that come from a <input type="date"> and are
 * stored/shown as a whole day (bill date, PO date, due dates, expense date,
 * exemption expiry, …).
 *
 * A bare "YYYY-MM-DD" parsed with `new Date()` is UTC midnight, which renders as
 * the *previous* day everywhere west of UTC (e.g. 2026-09-01 shows as Aug 31 in
 * the US). We anchor these at noon UTC on write and format from the UTC calendar
 * day on read, so the day the user picked is the day everyone sees.
 */

/** Parse a date-input value into a Date on the intended calendar day (noon UTC). */
export function parseDateInput(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  return new Date(s);
}

/** Format a stored date-only value as its calendar day, timezone-independent. */
export function formatDateOnly(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { timeZone: "UTC" });
}
