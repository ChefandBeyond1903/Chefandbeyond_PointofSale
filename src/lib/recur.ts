export const RECUR_FREQUENCIES = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type RecurFrequency = (typeof RECUR_FREQUENCIES)[number];

export const RECUR_FREQUENCY_LABEL: Record<string, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Every 3 months",
  YEARLY: "Yearly",
};

// Add whole months in UTC, keeping the day-of-month but clamping to the last
// day of the target month (so the 31st -> Feb 28, not spilling into March).
function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, lastDay));
  return x;
}

/**
 * The next occurrence after `d`. Dates in this app are whole calendar days
 * anchored at noon UTC, so step in UTC to keep the day-of-month stable.
 */
export function advanceRecurDate(d: Date, freq: string): Date {
  switch (freq) {
    case "WEEKLY": {
      const x = new Date(d);
      x.setUTCDate(x.getUTCDate() + 7);
      return x;
    }
    case "QUARTERLY":
      return addMonths(d, 3);
    case "YEARLY":
      return addMonths(d, 12);
    case "MONTHLY":
    default:
      return addMonths(d, 1);
  }
}
