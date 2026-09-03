import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, scopeStoreId } from "@/lib/scope";
import { salePaymentSchema } from "@/lib/validation";
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
        salesperson: { select: { id: true, name: true } },
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

// Record a payment against an unpaid invoice, settling it. The sale then
// counts as revenue on the payment date.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const body = salePaymentSchema.parse(await req.json());

    const sale = await prisma.sale.findUnique({
      where: { id },
      select: { id: true, status: true, storeId: true, totalCents: true },
    });
    if (!sale) throw new HttpError(404, "Invoice not found");
    const scoped = scopeStoreId(actor);
    if (scoped && sale.storeId !== scoped) throw new HttpError(404, "Invoice not found");
    if (sale.status !== "INVOICED") {
      throw new HttpError(400, "This invoice has already been settled.");
    }

    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    let tenderedCents = sale.totalCents;
    let changeCents = 0;
    if (body.paymentMethod === "CASH") {
      tenderedCents = body.tenderedCents || sale.totalCents;
      if (tenderedCents < sale.totalCents) {
        throw new HttpError(400, "Amount tendered is less than the invoice total");
      }
      changeCents = tenderedCents - sale.totalCents;
    }

    // Attach to whoever is recording the payment (their open till, if any) so a
    // cash payment reconciles the drawer.
    const openShift = await prisma.shift.findFirst({
      where: { userId: actor.id, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });

    const updated = await prisma.sale.update({
      where: { id },
      data: {
        status: "COMPLETED",
        paidAt,
        paymentMethod: body.paymentMethod,
        tenderedCents,
        changeCents,
        shiftId: openShift?.id ?? null,
      },
      include: {
        items: true,
        cashier: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        customer: true,
      },
    });
    return ok({ sale: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Permanently delete an invoice. Admin only. Puts the sold quantities back
// into the sale's store inventory, and cascades to line items and any purchase
// orders that were raised from this sale.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    if (actor.role !== "ADMIN") throw new HttpError(403, "Only an admin can delete invoices");
    const { id } = await params;

    const sale = await prisma.sale.findUnique({
      where: { id },
      select: { id: true, storeId: true, items: { select: { productId: true, quantity: true } } },
    });
    if (!sale) throw new HttpError(404, "Invoice not found");

    await prisma.$transaction(async (tx) => {
      if (sale.storeId) {
        const ids = sale.items.map((i) => i.productId);
        const tracked = new Set(
          (
            await tx.product.findMany({
              where: { id: { in: ids }, trackStock: true },
              select: { id: true },
            })
          ).map((p) => p.id),
        );
        for (const it of sale.items) {
          if (!tracked.has(it.productId)) continue;
          await tx.storeInventory.upsert({
            where: { productId_storeId: { productId: it.productId, storeId: sale.storeId } },
            create: { productId: it.productId, storeId: sale.storeId, quantity: it.quantity },
            update: { quantity: { increment: it.quantity } },
          });
        }
      }
      await tx.sale.delete({ where: { id } });
    });

    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
