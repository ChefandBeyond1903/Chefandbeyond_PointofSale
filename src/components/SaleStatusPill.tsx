import { Badge } from "@/components/Badge";
import { formatMoney } from "@/lib/money";

/**
 * The status pill for a sale/invoice — used on the Invoices list, a
 * customer's sales history, and anywhere else a sale's status needs to read
 * the same way. Owes/Paid/Part-refunded/Refunded/Voided, one shared mapping.
 */
export function SaleStatusPill({
  status,
  totalCents,
  amountPaidCents = 0,
  refundedCents = 0,
}: {
  status: string;
  totalCents: number;
  amountPaidCents?: number;
  refundedCents?: number;
}) {
  if (status === "INVOICED") {
    const balance = Math.max(0, totalCents - amountPaidCents);
    return <Badge tone="amber">{balance > 0 ? `Owes ${formatMoney(balance)}` : "Awaiting payment"}</Badge>;
  }
  if (status === "COMPLETED") {
    if (refundedCents > 0 && refundedCents < totalCents) {
      return <Badge tone="orange">Part-refunded</Badge>;
    }
    return <Badge tone="green">Paid</Badge>;
  }
  if (status === "REFUNDED") return <Badge tone="zinc">Refunded</Badge>;
  if (status === "VOIDED") return <Badge tone="zinc">Voided</Badge>;
  return <Badge tone="zinc">{status}</Badge>;
}
