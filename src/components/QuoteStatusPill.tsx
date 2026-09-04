import { Badge } from "@/components/Badge";
import type { QuoteStatus } from "@/lib/types";

/** The status pill for a quote — shared by the Quotes list and QuoteModal. */
export function QuoteStatusPill({ status }: { status: QuoteStatus | string }) {
  if (status === "OPEN") return <Badge tone="amber">Open</Badge>;
  if (status === "APPROVED") return <Badge tone="emerald">Approved</Badge>;
  if (status === "CONVERTED") return <Badge tone="indigo">Converted</Badge>;
  if (status === "REJECTED") return <Badge tone="red">Rejected</Badge>;
  return <Badge tone="zinc">{status}</Badge>;
}
