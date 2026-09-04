import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { saleRefundSchema } from "@/lib/validation";
import { parseEventDate } from "@/lib/date";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

// Refund a sale — whole or partial. Manager / admin only.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    const body = saleRefundSchema.parse(await req.json());

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { items: true, refunds: true },
    });
    if (!sale) throw new HttpError(404, "Sale not found");
    const scoped = scopeStoreId(actor);
    if (scoped && sale.storeId !== scoped) throw new HttpError(404, "Sale not found");

    // You can only refund money that was actually collected and not already
    // refunded.
    const refundable = sale.amountPaidCents - sale.refundedCents;
    if (refundable <= 0) throw new HttpError(400, "There's nothing left to refund on this sale.");
    const amountCents = body.amountCents ?? refundable;
    if (amountCents > refundable) {
      throw new HttpError(400, `Most you can refund is ${(refundable / 100).toFixed(2)}.`);
    }
    if (body.method === "CREDIT" && !sale.customerId) {
      throw new HttpError(400, "This sale has no customer — refund to cash or card instead.");
    }
    const checkNumber = (body.checkNumber ?? "").trim();
    if (body.method === "CHECK" && !checkNumber) {
      throw new HttpError(400, "Enter the check number for the refund.");
    }

    const alreadyRestocked = sale.refunds.some((r) => r.restocked);
    const doRestock = body.restock && !alreadyRestocked && !!sale.storeId;

    // Never stamp a refund in the future (a "today" date anchors at noon UTC).
    const refundedAt = parseEventDate(body.refundedAt);
    const openShift = await prisma.shift.findFirst({
      where: { userId: actor.id, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });

    const updated = await prisma.$transaction(async (tx) => {
      const refund = await tx.saleRefund.create({
        data: {
          saleId: id,
          amountCents,
          method: body.method,
          checkNumber,
          restocked: doRestock,
          reason: body.reason,
          refundedAt,
          createdById: actor.id,
          shiftId: openShift?.id ?? null,
        },
      });

      const newRefundedCents = sale.refundedCents + amountCents;
      const fully = newRefundedCents >= sale.totalCents;

      if (body.method === "CREDIT" && sale.customerId) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data: { storeCreditCents: { increment: amountCents } },
        });
        await tx.storeCreditEntry.create({
          data: {
            customerId: sale.customerId,
            amountCents,
            kind: "REFUND",
            reason: body.reason || `Refund of sale #${sale.number}`,
            saleId: id,
            refundId: refund.id,
            createdById: actor.id,
          },
        });
      }

      if (doRestock && sale.storeId) {
        const tracked = new Set(
          (
            await tx.product.findMany({
              where: { id: { in: sale.items.map((i) => i.productId) }, trackStock: true },
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

      const saleAfter = await tx.sale.update({
        where: { id },
        data: {
          refundedCents: newRefundedCents,
          ...(fully && sale.status === "COMPLETED" ? { status: "REFUNDED" } : {}),
        },
        include: {
          items: true,
          payments: { orderBy: { paidAt: "asc" } },
          refunds: { orderBy: { refundedAt: "asc" }, include: { createdBy: { select: { id: true, name: true } } } },
          cashier: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true } },
          customer: true,
        },
      });
      return { sale: saleAfter, refundId: refund.id };
    });

    return ok({ sale: updated.sale, refundId: updated.refundId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
