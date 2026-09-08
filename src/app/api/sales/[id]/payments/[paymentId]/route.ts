import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { formatMoney } from "@/lib/money";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string; paymentId: string }> };

// Undo a payment recorded against a sale by mistake. Manager / admin only.
// Reverses the amount, drops the sale back to INVOICED if it's no longer
// fully paid, and hands store credit back if the payment was store credit.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id, paymentId } = await params;

    const sale = await prisma.sale.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        storeId: true,
        status: true,
        totalCents: true,
        amountPaidCents: true,
        refundedCents: true,
        customerId: true,
        paidAt: true,
        payments: {
          select: { id: true, amountCents: true, method: true, isDeposit: true },
        },
      },
    });
    if (!sale) throw new HttpError(404, "Invoice not found");
    const scoped = scopeStoreId(actor);
    if (scoped && sale.storeId !== scoped) throw new HttpError(404, "Invoice not found");

    const payment = sale.payments.find((p) => p.id === paymentId);
    if (!payment) throw new HttpError(404, "That payment isn't on this invoice.");

    const newPaidCents = sale.amountPaidCents - payment.amountCents;
    if (newPaidCents < sale.refundedCents) {
      throw new HttpError(
        400,
        `This invoice has ${formatMoney(sale.refundedCents)} refunded against it — reverse the ` +
          `refund before removing this payment.`,
      );
    }

    // Still fully covered by the remaining payments? Then it stays settled.
    const stillSettled = newPaidCents >= sale.totalCents;

    await prisma.$transaction(async (tx) => {
      if (payment.method === "CREDIT" && sale.customerId) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data: { storeCreditCents: { increment: payment.amountCents } },
        });
        await tx.storeCreditEntry.create({
          data: {
            customerId: sale.customerId,
            amountCents: payment.amountCents,
            kind: "ADJUST",
            reason: `Payment removed from invoice #${sale.number}`,
            saleId: sale.id,
            createdById: actor.id,
          },
        });
      }

      await tx.salePayment.delete({ where: { id: paymentId } });

      await tx.sale.update({
        where: { id },
        data: {
          amountPaidCents: newPaidCents,
          ...(sale.status === "COMPLETED" && !stillSettled
            ? { status: "INVOICED", paidAt: null, tenderedCents: 0, changeCents: 0 }
            : {}),
        },
      });
    });

    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
