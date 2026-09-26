import type { Prisma } from "@prisma/client";

export const BILL_FEE_CATEGORIES = {
  shippingCents: "Shipping & postage",
  minOrderFeeCents: "Minimum Order Fee",
  dropShipFeeCents: "Drop Ship Fee",
} as const;

/** Early-pay discount, taken off the item total only (not fees). */
export function earlyPayDiscountCents(itemsCents: number, bps: number): number {
  return Math.round((Math.max(0, itemsCents) * bps) / 10_000);
}

/**
 * Keeps one operating Expense per non-zero bill fee, linked by billId. Fees
 * are real operating costs; vendor credit and the early-pay discount are not
 * expenses (they only reduce what the bill costs).
 */
export async function syncBillFeeExpenses(
  tx: Prisma.TransactionClient,
  bill: {
    id: string;
    vendor: string;
    billNumber: string;
    billDate: Date;
    storeId: string | null;
    status: string;
    paymentMethod: string;
    shippingCents: number;
    minOrderFeeCents: number;
    dropShipFeeCents: number;
  },
  actorId: string,
): Promise<void> {
  const existing = await tx.expense.findMany({ where: { billId: bill.id } });
  const label = bill.billNumber ? `bill #${bill.billNumber}` : "vendor bill";
  for (const key of Object.keys(BILL_FEE_CATEGORIES) as (keyof typeof BILL_FEE_CATEGORIES)[]) {
    const category = BILL_FEE_CATEGORIES[key];
    const amountCents = bill[key];
    const rows = existing.filter((e) => e.category === category);
    if (amountCents <= 0) {
      if (rows.length) await tx.expense.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      continue;
    }
    const data = {
      payee: bill.vendor,
      amountCents,
      expenseDate: bill.billDate,
      status: bill.status === "PAID" ? "PAID" : "UNPAID",
      paymentMethod: bill.paymentMethod,
      memo: `${category} on ${label}`,
      storeId: bill.storeId,
    };
    if (rows.length) {
      await tx.expense.update({ where: { id: rows[0].id }, data });
      if (rows.length > 1) {
        await tx.expense.deleteMany({ where: { id: { in: rows.slice(1).map((r) => r.id) } } });
      }
    } else {
      await tx.expense.create({
        data: { ...data, category, billId: bill.id, createdById: actorId },
      });
    }
  }
}
