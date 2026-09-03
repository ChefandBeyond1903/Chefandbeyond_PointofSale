import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, HttpError } from "@/lib/auth";
import { storeCreditAdjustSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

const ledgerSelect = {
  id: true,
  amountCents: true,
  kind: true,
  reason: true,
  saleId: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

// The store-credit ledger for one customer.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireRole("CASHIER", "MANAGER", "ADMIN");
    const { id } = await params;
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: { id: true, storeCreditCents: true },
    });
    if (!customer) throw new HttpError(404, "Customer not found");
    const ledger = await prisma.storeCreditEntry.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: ledgerSelect,
    });
    return ok({ storeCreditCents: customer.storeCreditCents, ledger });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Grant or adjust store credit. Manager / admin only.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireRole("MANAGER", "ADMIN");
    const { id } = await params;
    const { amountCents, reason } = storeCreditAdjustSchema.parse(await req.json());

    const customer = await prisma.$transaction(async (tx) => {
      const c = await tx.customer.findUnique({
        where: { id },
        select: { id: true, storeCreditCents: true },
      });
      if (!c) throw new HttpError(404, "Customer not found");
      const next = c.storeCreditCents + amountCents;
      if (next < 0) {
        throw new HttpError(
          400,
          `That would take store credit below zero (balance is ${(c.storeCreditCents / 100).toFixed(2)}).`,
        );
      }
      await tx.storeCreditEntry.create({
        data: {
          customerId: id,
          amountCents,
          kind: amountCents > 0 ? "ISSUE" : "ADJUST",
          reason,
          createdById: actor.id,
        },
      });
      return tx.customer.update({ where: { id }, data: { storeCreditCents: next } });
    });

    const ledger = await prisma.storeCreditEntry.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: ledgerSelect,
    });
    return ok({ customer, storeCreditCents: customer.storeCreditCents, ledger });
  } catch (err) {
    return toErrorResponse(err);
  }
}
