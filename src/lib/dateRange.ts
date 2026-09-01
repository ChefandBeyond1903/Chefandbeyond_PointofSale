// Preset date ranges for the date-range picker. All math is in the browser's
// local timezone; weeks run Sunday–Saturday.

export type DateRangePresetKey =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "last_30_days"
  | "this_quarter"
  | "last_quarter"
  | "last_3_months"
  | "last_6_months";

export const DATE_RANGE_PRESETS: { key: DateRangePresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_30_days", label: "Last 30 days" },
  { key: "this_quarter", label: "This quarter" },
  { key: "last_quarter", label: "Last quarter" },
  { key: "last_3_months", label: "Last 3 months" },
  { key: "last_6_months", label: "Last 6 months" },
];

export interface DateRange {
  from: Date;
  to: Date;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeek(d: Date): Date {
  // Sunday as the first day of the week.
  return startOfDay(addDays(d, -d.getDay()));
}

function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function startOfQuarter(d: Date): Date {
  const x = startOfMonth(d);
  x.setMonth(Math.floor(x.getMonth() / 3) * 3);
  return x;
}

function minusMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() - n);
  return x;
}

/** The concrete {from, to} for a preset, relative to `now` (local time). */
export function resolvePreset(key: DateRangePresetKey, now: Date = new Date()): DateRange {
  switch (key) {
    case "today":
      return { from: startOfDay(now), to: now };
    case "yesterday": {
      const y = addDays(now, -1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "this_week":
      return { from: startOfWeek(now), to: now };
    case "last_week": {
      const from = addDays(startOfWeek(now), -7);
      return { from, to: endOfDay(addDays(from, 6)) };
    }
    case "this_month":
      return { from: startOfMonth(now), to: now };
    case "last_month":
      return {
        from: minusMonths(startOfMonth(now), 1),
        to: endOfDay(addDays(startOfMonth(now), -1)),
      };
    case "last_30_days":
      return { from: startOfDay(addDays(now, -29)), to: now };
    case "this_quarter":
      return { from: startOfQuarter(now), to: now };
    case "last_quarter": {
      const thisQ = startOfQuarter(now);
      return { from: minusMonths(thisQ, 3), to: endOfDay(addDays(thisQ, -1)) };
    }
    case "last_3_months":
      return { from: minusMonths(startOfDay(now), 3), to: now };
    case "last_6_months":
      return { from: minusMonths(startOfDay(now), 6), to: now };
  }
}

/** Parse a `<input type="date">` value ("YYYY-MM-DD") as a local date. */
export function parseLocalDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a Date as "YYYY-MM-DD" in local time (for `<input type="date">`). */
export function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
