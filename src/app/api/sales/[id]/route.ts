import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        items: true,
        cashier: { select: { id: true, name: true } },
        customer: true,
        purchaseOrders: {
          orderBy: { poNumber: "asc" },
          include: { items: true, createdBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!sale) throw new HttpError(404, "Sale not found");

    const scopedStore = scopeStoreId(actor);
    if (scopedStore && sale.storeId !== scopedStore) {
      throw new HttpError(404, "Sale not found");
    }

    // Group line items by vendor so the UI can offer one PO per vendor.
    const vendorMap = new Map<string, { vendor: string; quantity: number; costCents: number }>();
    for (const it of sale.items) {
      const v = it.vendorSnapshot || "";
      const g = vendorMap.get(v) ?? { vendor: v, quantity: 0, costCents: 0 };
      g.quantity += it.quantity;
      g.costCents += it.unitCostCents * it.quantity;
      vendorMap.set(v, g);
    }
    const vendors = [...vendorMap.values()]
      .filter((g) => g.vendor)
      .sort((a, b) => a.vendor.toLowerCase().localeCompare(b.vendor.toLowerCase()))
      .map((g, i) => ({
        ...g,
        letter: String.fromCharCode(65 + i),
        poNumber: `${sale.number}${String.fromCharCode(65 + i)}`,
        hasPo: sale.purchaseOrders.some((po) => po.vendor === g.vendor),
      }));
    const unassignedQty = vendorMap.get("")?.quantity ?? 0;

    return ok({ sale, vendors, unassignedQty });
  } catch (err) {
    return toErrorResponse(err);
  }
}
