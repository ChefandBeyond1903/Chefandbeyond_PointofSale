import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireScopedUser, scopeStoreId, assertCustomerInScope } from "@/lib/scope";
import { heldSaleCreateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";
import type { HeldSaleLine } from "@/lib/types";

function linesOf(value: Prisma.JsonValue): HeldSaleLine[] {
  return Array.isArray(value) ? (value as unknown as HeldSaleLine[]) : [];
}

// The queue of parked carts. Non-admins see their own store's held sales
// (same scoping as /api/sales).
export async function GET() {
  try {
    const actor = await requireScopedUser();
    const scoped = scopeStoreId(actor);

    const rows = await prisma.heldSale.findMany({
      where: scoped ? { storeId: scoped } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { createdBy: { select: { name: true } } },
    });

    const spById = new Map(
      (
        await prisma.user.findMany({
          where: { id: { in: rows.map((r) => r.salespersonId).filter((x): x is string => !!x) } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );

    const heldSales = rows.map((r) => {
      const lines = linesOf(r.items);
      const lineNet = lines.reduce(
        (s, l) => s + Math.max(0, l.unitPriceCents * l.quantity - (l.discountCents ?? 0)),
        0,
      );
      return {
        id: r.id,
        label: r.label,
        note: r.note,
        customerName: r.customerName,
        itemCount: lines.reduce((s, l) => s + l.quantity, 0),
        approxTotalCents: Math.max(0, lineNet - r.orderDiscountCents) + r.shippingCents,
        salespersonName: r.salespersonId ? (spById.get(r.salespersonId) ?? null) : null,
        createdByName: r.createdBy.name,
        createdAt: r.createdAt.toISOString(),
      };
    });

    return ok({ heldSales });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const f = heldSaleCreateSchema.parse(await req.json());

    let cust = { name: "", email: "", phone: "", address: "", company: "" };
    if (f.customerId) {
      await assertCustomerInScope(f.customerId, actor);
      const c = await prisma.customer.findUnique({ where: { id: f.customerId } });
      if (c) cust = { name: c.name, email: c.email, phone: c.phone, address: c.address, company: c.company };
    } else if (f.customer) {
      cust = {
        name: f.customer.name ?? "",
        email: f.customer.email ?? "",
        phone: f.customer.phone ?? "",
        address: f.customer.address ?? "",
        company: f.customer.company ?? "",
      };
    }

    const items: HeldSaleLine[] = f.items.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents ?? 0,
      discountCents: l.discountCents,
    }));

    const held = await prisma.heldSale.create({
      data: {
        label: f.label || cust.name,
        note: f.note,
        orderDiscountCents: f.orderDiscountCents,
        shippingCents: f.shippingCents,
        storeId: actor.storeId ?? null,
        salespersonId: f.salespersonId ?? null,
        customerId: f.customerId ?? null,
        customerName: cust.name,
        customerEmail: cust.email,
        customerPhone: cust.phone,
        customerAddress: cust.address,
        customerCompany: cust.company,
        items: items as unknown as Prisma.InputJsonValue,
        createdById: actor.id,
      },
      select: { id: true },
    });

    return ok({ id: held.id }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
