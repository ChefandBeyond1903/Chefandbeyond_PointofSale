import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { purchaseOrderFormSchema } from "@/lib/validation";

type Form = z.infer<typeof purchaseOrderFormSchema>;
type ItemLine = Form["itemLines"][number];
type CategoryLine = Form["categoryLines"][number];

/** "CB-MMDDYY" for a given date. */
export function defaultPoNumber(d = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `CB-${mm}${dd}${yy}`;
}

/**
 * Rejects a PO number already used by another purchase order, instead of
 * silently renaming it — the user typed (or kept) that number on purpose,
 * so a collision should stop them and say why, not quietly become "-2".
 */
export async function assertPoNumberAvailable(poNumber: string, excludeId?: string): Promise<void> {
  const conflict = await prisma.purchaseOrder.findUnique({
    where: { poNumber },
    select: { id: true, vendor: true },
  });
  if (conflict && conflict.id !== excludeId) {
    throw new HttpError(
      409,
      `PO number "${poNumber}" is already used by a purchase order for ${conflict.vendor || "another vendor"} — pick a different number.`,
    );
  }
}

export function itemAmountCents(l: Pick<ItemLine, "quantity" | "rateCents">): number {
  return Math.round(l.quantity * l.rateCents);
}

export function computeSubtotalCents(
  categoryLines: CategoryLine[],
  itemLines: ItemLine[],
  shippingCents = 0,
  dropShipFeeCents = 0,
  taxCents = 0,
): number {
  const cat = categoryLines.reduce((s, l) => s + l.amountCents, 0);
  const item = itemLines.reduce((s, l) => s + itemAmountCents(l), 0);
  return cat + item + shippingCents + dropShipFeeCents + taxCents;
}

/** Nested `create` payloads for the two line tables. */
export function lineCreateData(categoryLines: CategoryLine[], itemLines: ItemLine[]) {
  return {
    categoryLines: {
      create: categoryLines.map((l, i) => ({
        category: l.category,
        description: l.description,
        amountCents: l.amountCents,
        customerProject: l.customerProject,
        klass: l.klass,
        sortOrder: i,
      })),
    },
    items: {
      create: itemLines.map((l, i) => ({
        productId: l.productId ?? null,
        nameSnapshot: l.productService,
        skuSnapshot: l.sku,
        description: l.description,
        quantity: l.quantity,
        unitCostCents: l.rateCents,
        lineCostCents: itemAmountCents(l),
        customerProject: l.customerProject,
        klass: l.klass,
        sortOrder: i,
      })),
    },
  };
}

/**
 * Recomputes and stores a PO's subtotal from its items, category lines,
 * shipping/drop-ship/tax charges, and any operating expenses logged against
 * it — so the PO's Total reflects an extra cost the moment it's added or
 * removed, everywhere subtotalCents is shown (this form, the list, Bills).
 */
export async function recomputePoSubtotalCents(
  db: Prisma.TransactionClient,
  poId: string,
): Promise<void> {
  const po = await db.purchaseOrder.findUnique({
    where: { id: poId },
    select: {
      shippingCents: true,
      dropShipFeeCents: true,
      taxCents: true,
      items: { select: { lineCostCents: true } },
      categoryLines: { select: { amountCents: true } },
      expenses: { select: { amountCents: true } },
    },
  });
  if (!po) return;
  const itemsSum = po.items.reduce((s, l) => s + l.lineCostCents, 0);
  const catSum = po.categoryLines.reduce((s, l) => s + l.amountCents, 0);
  const expensesSum = po.expenses.reduce((s, e) => s + e.amountCents, 0);
  const subtotalCents =
    itemsSum + catSum + po.shippingCents + po.dropShipFeeCents + po.taxCents + expensesSum;
  await db.purchaseOrder.update({ where: { id: poId }, data: { subtotalCents } });
}

export function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
