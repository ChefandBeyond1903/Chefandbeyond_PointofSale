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

    // Drawer math is driven by the actual payments taken this shift (deposits,
    // partials and full settlements alike), not by sale totals.
    const allPay = await prisma.salePayment.aggregate({
      where: { shiftId: shift.id },
      _sum: { amountCents: true },
      _count: true,
    });
    const cashPay = await prisma.salePayment.aggregate({
      where: { shiftId: shift.id, method: "CASH" },
      _sum: { amountCents: true },
    });
    const cashCents = cashPay._sum.amountCents ?? 0;

    return ok({
      shift,
      stats: {
        saleCount: allPay._count,
        totalCents: allPay._sum.amountCents ?? 0,
        cashSalesCents: cashCents,
        expectedDrawerCents: shift.openingFloatCents + cashCents,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
