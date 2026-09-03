import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, requireScopedRole, scopeStoreId } from "@/lib/scope";
import { salePaymentSchema, saleEditSchema } from "@/lib/validation";
import { parseDateInput } from "@/lib/date";
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
        payments: {
          orderBy: { paidAt: "asc" },
          include: { createdBy: { select: { id: true, name: true } } },
        },
        refunds: {
          orderBy: { refundedAt: "asc" },
          include: { createdBy: { select: { id: true, name: true } } },
        },
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

// PATCH does two jobs:
//  - a body with `paymentMethod` records a payment against an INVOICED sale;
//  - anything else edits the invoice's note / bill-to details (manager+).
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const raw = await req.json();
    const { id } = await params;

    // --- edit the note / bill-to details ---
    if (!raw || typeof raw !== "object" || !("paymentMethod" in raw)) {
      const editor = await requireScopedRole("MANAGER", "ADMIN");
      const scoped = scopeStoreId(editor);
      const cur = await prisma.sale.findUnique({ where: { id }, select: { storeId: true } });
      if (!cur || (scoped && cur.storeId !== scoped)) throw new HttpError(404, "Invoice not found");
      const fields = saleEditSchema.parse(raw);
      const data: Record<string, unknown> = {};
      for (const k of Object.keys(fields) as (keyof typeof fields)[]) {
        if (fields[k] !== undefined) data[k] = fields[k];
      }
      const sale = await prisma.sale.update({
        where: { id },
        data,
        include: {
          items: true,
          payments: { orderBy: { paidAt: "asc" } },
          refunds: { orderBy: { refundedAt: "asc" }, include: { createdBy: { select: { id: true, name: true } } } },
          cashier: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true } },
          customer: true,
        },
      });
      return ok({ sale });
    }

    // --- record a payment ---
    const actor = await requireScopedUser();
    const body = salePaymentSchema.parse(raw);

    const sale = await prisma.sale.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        storeId: true,
        totalCents: true,
        amountPaidCents: true,
        customerId: true,
        number: true,
        customer: { select: { storeCreditCents: true } },
      },
    });
    if (!sale) throw new HttpError(404, "Invoice not found");
    const scoped = scopeStoreId(actor);
    if (scoped && sale.storeId !== scoped) throw new HttpError(404, "Invoice not found");
    if (sale.status !== "INVOICED") {
      throw new HttpError(400, "This invoice has already been settled.");
    }

    const balanceCents = sale.totalCents - sale.amountPaidCents;
    const amountCents = body.amountCents ?? balanceCents;
    if (amountCents < 1) throw new HttpError(400, "Enter a payment amount.");
    if (amountCents > balanceCents) {
      throw new HttpError(400, `That's more than the balance due (${balanceCents / 100}).`);
    }
    if (body.paymentMethod === "CREDIT") {
      const avail = sale.customer?.storeCreditCents ?? 0;
      if (!sale.customerId) throw new HttpError(400, "This invoice has no customer for store credit.");
      if (amountCents > avail) {
        throw new HttpError(400, `Only ${(avail / 100).toFixed(2)} of store credit is available.`);
      }
    }

    const paidAt = body.paidAt ? parseDateInput(body.paidAt) : new Date();
    const newPaidCents = sale.amountPaidCents + amountCents;
    const settled = newPaidCents >= sale.totalCents;

    let tenderedCents = amountCents;
    let changeCents = 0;
    if (body.paymentMethod === "CASH" && body.tenderedCents) {
      tenderedCents = body.tenderedCents;
      if (tenderedCents < amountCents) {
        throw new HttpError(400, "Amount tendered is less than the payment amount");
      }
      changeCents = tenderedCents - amountCents;
    }

    // Attach to whoever is recording it (their open till), so cash reconciles.
    const openShift = await prisma.shift.findFirst({
      where: { userId: actor.id, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.salePayment.create({
        data: {
          saleId: id,
          amountCents,
          method: body.paymentMethod,
          paidAt,
          isDeposit: !settled,
          createdById: actor.id,
          shiftId: openShift?.id ?? null,
        },
      });
      if (body.paymentMethod === "CREDIT" && sale.customerId) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data: { storeCreditCents: { decrement: amountCents } },
        });
        await tx.storeCreditEntry.create({
          data: {
            customerId: sale.customerId,
            amountCents: -amountCents,
            kind: "SPEND",
            reason: `Invoice #${sale.number}`,
            saleId: id,
            createdById: actor.id,
          },
        });
      }
      return tx.sale.update({
        where: { id },
        data: {
          amountPaidCents: newPaidCents,
          ...(settled
            ? {
                status: "COMPLETED",
                paidAt,
                paymentMethod: body.paymentMethod,
                tenderedCents,
                changeCents,
                shiftId: openShift?.id ?? null,
              }
            : {}),
        },
        include: {
          items: true,
          payments: { orderBy: { paidAt: "asc" } },
          cashier: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true } },
          customer: true,
        },
      });
    });
    return ok({ sale: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Permanently delete a sale or open invoice. Admin only. Puts the sold
// quantities back into inventory, hands any store credit spent on it back to
// the customer, and cascades to line items, payments, refunds and any purchase
// orders raised from it.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    if (actor.role !== "ADMIN") throw new HttpError(403, "Only an admin can delete invoices");
    const { id } = await params;

    const sale = await prisma.sale.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        storeId: true,
        customerId: true,
        items: { select: { productId: true, quantity: true } },
        payments: { select: { method: true, amountCents: true } },
        refunds: { select: { method: true, amountCents: true } },
      },
    });
    if (!sale) throw new HttpError(404, "Invoice not found");

    // Net store credit this sale consumed: credit spent as payment, minus any
    // credit handed back via a refund. Delete un-does both.
    const creditSpent = sale.payments
      .filter((p) => p.method === "CREDIT")
      .reduce((s, p) => s + p.amountCents, 0);
    const creditRefunded = sale.refunds
      .filter((r) => r.method === "CREDIT")
      .reduce((s, r) => s + r.amountCents, 0);
    const creditToRestore = creditSpent - creditRefunded;

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

      if (sale.customerId && creditToRestore !== 0) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data: { storeCreditCents: { increment: creditToRestore } },
        });
        await tx.storeCreditEntry.create({
          data: {
            customerId: sale.customerId,
            amountCents: creditToRestore,
            kind: "ADJUST",
            reason: `Deleted sale #${sale.number}`,
            createdById: actor.id,
          },
        });
      }
      // Drop this sale's own credit-ledger rows (they'd dangle otherwise).
      await tx.storeCreditEntry.deleteMany({ where: { saleId: id } });

      await tx.sale.delete({ where: { id } });
    });

    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
