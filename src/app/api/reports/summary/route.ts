import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { ok, toErrorResponse } from "@/lib/api";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function GET(req: NextRequest) {
  try {
    await requireRole("MANAGER");
    const { searchParams } = new URL(req.url);
    const now = new Date();
    const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : startOfDay(now);
    const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;

    const where = {
      status: "COMPLETED",
      createdAt: { gte: from, lte: to },
    } as const;

    const [agg, byMethod, sales, itemRows] = await Promise.all([
      prisma.sale.aggregate({
        where,
        _sum: { totalCents: true, taxCents: true, discountCents: true, subtotalCents: true },
        _count: true,
      }),
      prisma.sale.groupBy({
        by: ["paymentMethod"],
        where,
        _sum: { totalCents: true },
        _count: true,
      }),
      prisma.sale.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { cashier: { select: { name: true } }, items: { select: { quantity: true } } },
      }),
      prisma.saleItem.groupBy({
        by: ["productId", "nameSnapshot"],
        where: { sale: { status: "COMPLETED", createdAt: { gte: from, lte: to } } },
        _sum: { quantity: true, lineTotalCents: true },
      }),
    ]);

    const topProducts = itemRows
      .map((r) => ({
        productId: r.productId,
        name: r.nameSnapshot,
        quantity: r._sum.quantity ?? 0,
        revenueCents: r._sum.lineTotalCents ?? 0,
      }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    const itemsSold = itemRows.reduce((sum, r) => sum + (r._sum.quantity ?? 0), 0);

    return ok({
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        saleCount: agg._count,
        grossCents: agg._sum.totalCents ?? 0,
        subtotalCents: agg._sum.subtotalCents ?? 0,
        taxCents: agg._sum.taxCents ?? 0,
        discountCents: agg._sum.discountCents ?? 0,
        itemsSold,
        averageSaleCents: agg._count > 0 ? Math.round((agg._sum.totalCents ?? 0) / agg._count) : 0,
      },
      byPaymentMethod: byMethod.map((m) => ({
        method: m.paymentMethod,
        count: m._count,
        totalCents: m._sum.totalCents ?? 0,
      })),
      topProducts,
      recentSales: sales.map((s) => ({
        id: s.id,
        number: s.number,
        createdAt: s.createdAt.toISOString(),
        cashier: s.cashier.name,
        paymentMethod: s.paymentMethod,
        itemCount: s.items.reduce((sum, i) => sum + i.quantity, 0),
        totalCents: s.totalCents,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
