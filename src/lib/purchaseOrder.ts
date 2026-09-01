import { z } from "zod";
import { prisma } from "@/lib/prisma";
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

/** Find a free PO number, adding -2, -3… on collision. */
export async function uniquePoNumber(preferred?: string): Promise<string> {
  const base = preferred?.trim() || defaultPoNumber();
  let candidate = base;
  let n = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.purchaseOrder.findUnique({ where: { poNumber: candidate }, select: { id: true } })) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

export function itemAmountCents(l: Pick<ItemLine, "quantity" | "rateCents">): number {
  return Math.round(l.quantity * l.rateCents);
}

export function computeSubtotalCents(
  categoryLines: CategoryLine[],
  itemLines: ItemLine[],
  shippingCents = 0,
): number {
  const cat = categoryLines.reduce((s, l) => s + l.amountCents, 0);
  const item = itemLines.reduce((s, l) => s + itemAmountCents(l), 0);
  return cat + item + shippingCents;
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

export function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
