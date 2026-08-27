import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { saleCreateSchema } from "@/lib/validation";
import { computeSale, type PricedInput } from "@/lib/sale";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const { searchParams } = new URL(req.url);
    const take = Math.min(Number(searchParams.get("take") ?? 50), 200);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const cashierId = searchParams.get("cashierId")?.trim();

    const where: Prisma.SaleWhereInput = {};
    if (cashierId) where.cashierId = cashierId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const sales = await prisma.sale.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      include: {
        cashier: { select: { id: true, name: true } },
        items: true,
      },
    });
    return ok({ sales });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = saleCreateSchema.parse(await req.json());

    // Merge duplicate product lines defensively.
    const merged = new Map<string, { quantity: number; discountCents: number }>();
    for (const item of body.items) {
      const prev = merged.get(item.productId);
      if (prev) {
        prev.quantity += item.quantity;
        prev.discountCents += item.discountCents;
      } else {
        merged.set(item.productId, { quantity: item.quantity, discountCents: item.discountCents });
      }
    }

    const productIds = [...merged.keys()];
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    if (products.length !== productIds.length) {
      throw new HttpError(400, "One or more products no longer exist");
    }

    const priced: PricedInput[] = [];
    for (const p of products) {
      const line = merged.get(p.id)!;
      if (!p.active) throw new HttpError(400, `"${p.name}" is not available for sale`);
      if (p.trackStock && p.stock < line.quantity) {
        throw new HttpError(409, `Not enough stock for "${p.name}" (${p.stock} left)`);
      }
      priced.push({
        productId: p.id,
        name: p.name,
        unitPriceCents: p.priceCents,
        quantity: line.quantity,
        lineDiscountCents: line.discountCents,
        taxRateBps: p.taxRateBps,
      });
    }

    const computed = computeSale(priced, body.orderDiscountCents);

    let tenderedCents = computed.totalCents;
    let changeCents = 0;
    if (body.paymentMethod === "CASH") {
      tenderedCents = body.tenderedCents;
      if (tenderedCents < computed.totalCents) {
        throw new HttpError(400, "Amount tendered is less than the total due");
      }
      changeCents = tenderedCents - computed.totalCents;
    }

    const openShift = await prisma.shift.findFirst({
      where: { userId: user.id, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });

    const sale = await prisma.$transaction(async (tx) => {
      const last = await tx.sale.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
      const number = (last?.number ?? 0) + 1;

      const created = await tx.sale.create({
        data: {
          number,
          status: "COMPLETED",
          subtotalCents: computed.subtotalCents,
          discountCents: computed.discountCents,
          taxCents: computed.taxCents,
          totalCents: computed.totalCents,
          paymentMethod: body.paymentMethod,
          tenderedCents,
          changeCents,
          note: body.note,
          cashierId: user.id,
          shiftId: openShift?.id ?? null,
          items: {
            create: computed.lines.map((l) => ({
              productId: l.productId,
              nameSnapshot: l.nameSnapshot,
              unitPriceCents: l.unitPriceCents,
              quantity: l.quantity,
              discountCents: l.discountCents,
              taxRateBps: l.taxRateBps,
              lineTotalCents: l.lineTotalCents,
            })),
          },
        },
        include: { items: true, cashier: { select: { id: true, name: true } } },
      });

      for (const p of products) {
        if (!p.trackStock) continue;
        const line = merged.get(p.id)!;
        await tx.product.update({
          where: { id: p.id },
          data: { stock: { decrement: line.quantity } },
        });
      }

      return created;
    });

    return ok({ sale }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
