import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { poReceiveSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

const poInclude = {
  items: { orderBy: { sortOrder: "asc" } },
  categoryLines: { orderBy: { sortOrder: "asc" } },
  createdBy: { select: { id: true, name: true } },
  sale: { select: { id: true, number: true } },
} as const;

// Receive items against a purchase order. Each line's receivedQuantity is
// updated and the matching product's on-hand at the PO's store moves by the
// same amount. receiveQty may be negative to correct an over-receipt.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("CASHIER", "MANAGER", "ADMIN");
    const { id } = await params;
    const body = poReceiveSchema.parse(await req.json());

    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, storeId: true, status: true, items: true },
    });
    if (!po) throw new HttpError(404, "Purchase order not found");
    const scoped = scopeStoreId(actor);
    if (scoped && po.storeId !== scoped) throw new HttpError(404, "Purchase order not found");
    if (!po.storeId) {
      throw new HttpError(400, "This purchase order has no store — it can't receive into inventory.");
    }
    const storeId = po.storeId;

    const byId = new Map(po.items.map((it) => [it.id, it]));

    const updated = await prisma.$transaction(async (tx) => {
      for (const l of body.lines) {
        const it = byId.get(l.itemId);
        if (!it) throw new HttpError(400, "A line isn't on this purchase order");
        const nextReceived = Math.max(0, it.receivedQuantity + l.receiveQty);
        const applied = nextReceived - it.receivedQuantity; // real change after clamping
        if (applied === 0) continue;

        await tx.purchaseOrderItem.update({
          where: { id: it.id },
          data: { receivedQuantity: nextReceived },
        });

        if (it.productId) {
          await tx.storeInventory.upsert({
            where: { productId_storeId: { productId: it.productId, storeId } },
            create: { productId: it.productId, storeId, quantity: applied },
            update: { quantity: { increment: applied } },
          });
        }
      }

      const fresh = await tx.purchaseOrder.findUnique({
        where: { id },
        select: { status: true, items: { select: { quantity: true, receivedQuantity: true } } },
      });
      const items = fresh?.items ?? [];
      const anyReceived = items.some((i) => i.receivedQuantity > 0);
      const allReceived = items.length > 0 && items.every((i) => i.receivedQuantity >= i.quantity);
      const status = allReceived ? "RECEIVED" : anyReceived ? "PARTIAL" : (fresh?.status ?? po.status);

      return tx.purchaseOrder.update({ where: { id }, data: { status }, include: poInclude });
    });

    return ok({ purchaseOrder: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
