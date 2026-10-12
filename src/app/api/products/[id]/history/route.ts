import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScopedUser, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

// Most recent N of each — plenty for "when did we last sell/order this" without
// hauling a popular product's entire lifetime history over the wire.
const HISTORY_LIMIT = 200;

// Every invoice this product has appeared on, and every purchase order it's
// been ordered on — "who we sold it to and when we ordered it", for the
// History section on the product's edit panel.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const scoped = scopeStoreId(actor);

    const [saleItems, poItems] = await Promise.all([
      prisma.saleItem.findMany({
        where: { productId: id, ...(scoped ? { sale: { storeId: scoped } } : {}) },
        orderBy: { sale: { createdAt: "desc" } },
        take: HISTORY_LIMIT,
        select: {
          quantity: true,
          unitPriceCents: true,
          lineTotalCents: true,
          serialNumber: true,
          sale: {
            select: {
              id: true,
              number: true,
              websiteOrderNumber: true,
              status: true,
              createdAt: true,
              customerNameSnapshot: true,
              customerCompanySnapshot: true,
              storeNameSnapshot: true,
            },
          },
        },
      }),
      prisma.purchaseOrderItem.findMany({
        where: { productId: id, ...(scoped ? { po: { storeId: scoped } } : {}) },
        orderBy: { po: { poDate: "desc" } },
        take: HISTORY_LIMIT,
        select: {
          quantity: true,
          receivedQuantity: true,
          unitCostCents: true,
          lineCostCents: true,
          po: {
            select: {
              id: true,
              poNumber: true,
              vendor: true,
              status: true,
              poDate: true,
              storeName: true,
            },
          },
        },
      }),
    ]);

    const sales = saleItems.map((it) => ({
      saleId: it.sale.id,
      number: it.sale.number,
      websiteOrderNumber: it.sale.websiteOrderNumber,
      status: it.sale.status,
      date: it.sale.createdAt.toISOString(),
      customer: it.sale.customerCompanySnapshot || it.sale.customerNameSnapshot || "",
      store: it.sale.storeNameSnapshot,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      lineTotalCents: it.lineTotalCents,
      serialNumber: it.serialNumber,
    }));

    const purchaseOrders = poItems.map((it) => ({
      poId: it.po.id,
      poNumber: it.po.poNumber,
      vendor: it.po.vendor,
      status: it.po.status,
      date: it.po.poDate.toISOString(),
      store: it.po.storeName,
      quantity: it.quantity,
      receivedQuantity: it.receivedQuantity,
      unitCostCents: it.unitCostCents,
      lineCostCents: it.lineCostCents,
    }));

    return ok({ sales, purchaseOrders });
  } catch (err) {
    return toErrorResponse(err);
  }
}
