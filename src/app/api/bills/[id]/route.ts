import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, requireScopedRole, scopeStoreId } from "@/lib/scope";
import { billUpdateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

async function loadScoped(id: string, actor: Awaited<ReturnType<typeof requireScopedUser>>) {
  const bill = await prisma.bill.findUnique({
    where: { id },
    select: { id: true, storeId: true, poId: true },
  });
  const scoped = scopeStoreId(actor);
  if (!bill || (scoped && bill.storeId !== scoped)) throw new HttpError(404, "Bill not found");
  return bill;
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    await loadScoped(id, actor);
    const bill = await prisma.bill.findUnique({
      where: { id },
      include: {
        items: true,
        po: { select: { id: true, poNumber: true } },
        store: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    return ok({ bill });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    await loadScoped(id, actor);
    const body = billUpdateSchema.parse(await req.json());

    const data: Record<string, unknown> = {};
    if (body.billNumber !== undefined) data.billNumber = body.billNumber;
    if (body.terms !== undefined) data.terms = body.terms;
    if (body.memo !== undefined) data.memo = body.memo;
    if (body.billDate !== undefined) data.billDate = body.billDate ? new Date(body.billDate) : new Date();
    if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.status !== undefined) {
      data.status = body.status;
      data.paidAt = body.status === "PAID" ? new Date() : null;
    }

    const bill = await prisma.bill.update({
      where: { id },
      data,
      include: {
        items: true,
        po: { select: { id: true, poNumber: true } },
        store: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    return ok({ bill });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Deleting a bill reverses its receipt: PO line receivedQuantity and store
// inventory both move back by the billed amounts.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    await loadScoped(id, actor);

    const bill = await prisma.bill.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!bill) throw new HttpError(404, "Bill not found");

    await prisma.$transaction(async (tx) => {
      for (const it of bill.items) {
        if (it.poItemId) {
          await tx.purchaseOrderItem.update({
            where: { id: it.poItemId },
            data: { receivedQuantity: { decrement: it.quantity } },
          });
        }
        if (it.productId && bill.storeId) {
          await tx.storeInventory.upsert({
            where: { productId_storeId: { productId: it.productId, storeId: bill.storeId } },
            create: { productId: it.productId, storeId: bill.storeId, quantity: -it.quantity },
            update: { quantity: { decrement: it.quantity } },
          });
        }
      }

      await tx.bill.delete({ where: { id } });

      if (bill.poId) {
        const fresh = await tx.purchaseOrder.findUnique({
          where: { id: bill.poId },
          select: { status: true, items: { select: { quantity: true, receivedQuantity: true } } },
        });
        const items = fresh?.items ?? [];
        const anyReceived = items.some((i) => i.receivedQuantity > 0);
        const allReceived =
          items.length > 0 && items.every((i) => i.receivedQuantity >= i.quantity);
        const status = allReceived
          ? "RECEIVED"
          : anyReceived
            ? "PARTIAL"
            : (fresh?.status === "PARTIAL" || fresh?.status === "RECEIVED"
                ? "OPEN"
                : (fresh?.status ?? "OPEN"));
        await tx.purchaseOrder.update({ where: { id: bill.poId }, data: { status } });
      }
    });

    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
