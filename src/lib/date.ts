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

/** Today's date as a local-calendar "YYYY-MM-DD" for seeding an <input type="date">. */
export function todayInputValue(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

/** Parse a date-input value into a Date on the intended calendar day (noon UTC). */
export function parseDateInput(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  return new Date(s);
}

/**
 * Parse a date-input value for an event that has already happened (a payment,
 * a refund). Same calendar-day handling as `parseDateInput`, but never returns
 * a moment in the future: a value picked for "today" anchors at noon UTC, which
 * is hours ahead of the real clock just after UTC midnight — a payment stamped
 * then would fall outside every "up to now" report range. Falls back to now
 * when nothing is given.
 */
export function parseEventDate(s: string | null | undefined): Date {
  const now = new Date();
  if (!s || !s.trim()) return now;
  const d = parseDateInput(s);
  return d.getTime() > now.getTime() ? now : d;
}

/** Format a stored date-only value as its calendar day, timezone-independent. */
export function formatDateOnly(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { timeZone: "UTC" });
}
