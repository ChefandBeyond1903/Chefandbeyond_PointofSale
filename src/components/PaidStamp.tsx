/** A stamp-style "PAID" badge for POs/bills, with how (and when) it was paid. */
export function PaidStamp({ detail }: { detail?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="-rotate-6 rounded border-2 border-emerald-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-600">
        Paid
      </span>
      {detail && <span className="text-sm text-zinc-500">{detail}</span>}
    </span>
  );
}
