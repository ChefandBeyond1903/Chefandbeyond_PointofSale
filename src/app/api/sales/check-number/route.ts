import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScopedUser } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

// Live duplicate check while typing a manual invoice # on the Create
// invoice form (admin only) — Sale.number is globally unique, so this is
// unscoped by store.
export async function GET(req: NextRequest) {
  try {
    await requireScopedUser();
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get("number")?.trim();
    const number = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isInteger(number) || number <= 0) return ok({ conflict: null });

    const conflict = await prisma.sale.findUnique({
      where: { number },
      select: { id: true, number: true, customerNameSnapshot: true, customerCompanySnapshot: true },
    });
    if (!conflict) return ok({ conflict: null });
    return ok({
      conflict: {
        id: conflict.id,
        number: conflict.number,
        name: conflict.customerCompanySnapshot || conflict.customerNameSnapshot || "",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
