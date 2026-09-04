// Shared status-pill look for every list screen (Invoices, Quotes, Customers'
// invoice history, …). Each screen still owns its own status → tone/label
// mapping — the statuses themselves mean different things (a Sale's
// COMPLETED isn't a Quote's APPROVED) — but they should all render the same
// rounded pill, not a screen-by-screen reinvention of one.
const TONES = {
  zinc: "bg-zinc-100 text-zinc-600",
  amber: "bg-amber-100 text-amber-800",
  green: "bg-green-100 text-green-700",
  emerald: "bg-emerald-100 text-emerald-700",
  red: "bg-red-100 text-red-700",
  orange: "bg-orange-100 text-orange-800",
  indigo: "bg-indigo-100 text-indigo-700",
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = "zinc",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
