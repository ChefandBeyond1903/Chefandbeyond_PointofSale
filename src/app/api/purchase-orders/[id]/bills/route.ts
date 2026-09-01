import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, requireScopedRole, scopeStoreId } from "@/lib/scope";
import { billCreateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

async function loadPoScoped(id: string, actor: Awaited<ReturnType<typeof requireScopedUser>>) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { id: true, vendor: true, storeId: true, status: true, items: true },
  });
  const scoped = scopeStoreId(actor);
  if (!po || (scoped && po.storeId !== scoped)) {
    throw new HttpError(404, "Purchase order not found");
  }
  return po;
}

// Bills recorded against this PO.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    await loadPoScoped(id, actor);
    const bills = await prisma.bill.findMany({
      where: { poId: id },
      orderBy: { billDate: "desc" },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });
    return ok({ bills });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Receive items on this PO and record a vendor bill for them.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("CASHIER", "MANAGER", "ADMIN");
    const { id } = await params;
    const body = billCreateSchema.parse(await req.json());
    const po = await loadPoScoped(id, actor);

    // Receiving store: an admin may direct the stock to any store; everyone
    // else receives into the PO's own store.
    let storeId = po.storeId;
    if (actor.role === "ADMIN" && body.storeId) {
      const s = await prisma.store.findUnique({ where: { id: body.storeId }, select: { id: true } });
      if (!s) throw new HttpError(400, "That store doesn't exist.");
      storeId = s.id;
    }
    if (!storeId) {
      throw new HttpError(
        400,
        "Choose a store to receive into — this purchase order isn't tied to one.",
      );
    }

    const byId = new Map(po.items.map((it) => [it.id, it]));
    const lines = body.lines
      .map((l) => {
        const it = byId.get(l.itemId);
        if (!it) throw new HttpError(400, "A line isn't on this purchase order");
        return { it, receiveQty: l.receiveQty, unitCostCents: l.unitCostCents };
      })
      .filter((l) => l.receiveQty !== 0);
    if (lines.length === 0) {
      throw new HttpError(400, "Enter a quantity to receive on at least one line.");
    }

    const billDate = body.billDate ? new Date(body.billDate) : new Date();
    const dueDate = body.dueDate ? new Date(body.dueDate) : null;
    const subtotalCents = lines.reduce((s, l) => s + l.receiveQty * l.unitCostCents, 0);

    const bill = await prisma.$transaction(async (tx) => {
      const created = await tx.bill.create({
        data: {
          billNumber: body.billNumber,
          vendor: po.vendor,
          billDate,
          dueDate,
          terms: body.terms,
          memo: body.memo,
          subtotalCents,
          storeId,
          poId: po.id,
          createdById: actor.id,
          items: {
            create: lines.map((l) => ({
              nameSnapshot: l.it.nameSnapshot,
              skuSnapshot: l.it.skuSnapshot,
              quantity: l.receiveQty,
              unitCostCents: l.unitCostCents,
              lineCostCents: l.receiveQty * l.unitCostCents,
              poItemId: l.it.id,
              productId: l.it.productId,
            })),
          },
        },
        include: { items: true, po: { select: { id: true, poNumber: true } } },
      });

      for (const l of lines) {
        await tx.purchaseOrderItem.update({
          where: { id: l.it.id },
          data: { receivedQuantity: { increment: l.receiveQty } },
        });
        if (l.it.productId) {
          await tx.storeInventory.upsert({
            where: { productId_storeId: { productId: l.it.productId, storeId } },
            create: { productId: l.it.productId, storeId, quantity: l.receiveQty },
            update: { quantity: { increment: l.receiveQty } },
          });
        }
      }

      const fresh = await tx.purchaseOrder.findUnique({
        where: { id },
        select: { status: true, items: { select: { quantity: true, receivedQuantity: true } } },
      });
      const items = fresh?.items ?? [];
      const anyReceived = items.some((i) => i.receivedQuantity > 0);
      const allReceived =
        items.length > 0 && items.every((i) => i.receivedQuantity >= i.quantity);
      const status = allReceived ? "RECEIVED" : anyReceived ? "PARTIAL" : (fresh?.status ?? po.status);
      await tx.purchaseOrder.update({ where: { id }, data: { status } });

      return created;
    });

    return ok({ bill }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
