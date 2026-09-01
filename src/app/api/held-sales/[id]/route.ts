import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";
import type { HeldSaleLine } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

function linesOf(value: Prisma.JsonValue): HeldSaleLine[] {
  return Array.isArray(value) ? (value as unknown as HeldSaleLine[]) : [];
}

async function loadScoped(id: string, actor: Awaited<ReturnType<typeof requireScopedUser>>) {
  const held = await prisma.heldSale.findUnique({ where: { id }, select: { storeId: true } });
  const scoped = scopeStoreId(actor);
  if (!held || (scoped && held.storeId !== scoped)) {
    throw new HttpError(404, "Held sale not found");
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    await loadScoped(id, actor);

    const held = await prisma.heldSale.findUnique({ where: { id } });
    if (!held) throw new HttpError(404, "Held sale not found");

    const lines = linesOf(held.items);
    const products = await prisma.product.findMany({
      where: { id: { in: lines.map((l) => l.productId) } },
      include: { category: { select: { id: true, name: true } } },
    });

    return ok({
      heldSale: {
        id: held.id,
        label: held.label,
        note: held.note,
        orderDiscountCents: held.orderDiscountCents,
        shippingCents: held.shippingCents,
        salespersonId: held.salespersonId,
        customerId: held.customerId,
        customerName: held.customerName,
        customerEmail: held.customerEmail,
        customerPhone: held.customerPhone,
        customerAddress: held.customerAddress,
        customerCompany: held.customerCompany,
        items: lines,
      },
      products: products.map((p) => ({ ...p, stock: 0 })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    await loadScoped(id, actor);
    await prisma.heldSale.delete({ where: { id } });
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
