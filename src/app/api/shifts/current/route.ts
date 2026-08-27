import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireUser();
    const shift = await prisma.shift.findFirst({
      where: { userId: user.id, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });
    if (!shift) return ok({ shift: null });

    const agg = await prisma.sale.aggregate({
      where: { shiftId: shift.id, status: "COMPLETED" },
      _sum: { totalCents: true, tenderedCents: true, changeCents: true },
      _count: true,
    });
    const cashAgg = await prisma.sale.aggregate({
      where: { shiftId: shift.id, status: "COMPLETED", paymentMethod: "CASH" },
      _sum: { totalCents: true },
    });

    return ok({
      shift,
      stats: {
        saleCount: agg._count,
        totalCents: agg._sum.totalCents ?? 0,
        cashSalesCents: cashAgg._sum.totalCents ?? 0,
        expectedDrawerCents: shift.openingFloatCents + (cashAgg._sum.totalCents ?? 0),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
