import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScopedUser } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

// Live duplicate check while typing a PO number on the form — unscoped by
// store, since PurchaseOrder.poNumber is globally unique (a conflict in
// another store still blocks the save).
export async function GET(req: NextRequest) {
  try {
    await requireScopedUser();
    const { searchParams } = new URL(req.url);
    const number = searchParams.get("number")?.trim();
    const excludeId = searchParams.get("excludeId")?.trim() || undefined;
    if (!number) return ok({ conflict: null });

    const conflict = await prisma.purchaseOrder.findUnique({
      where: { poNumber: number },
      select: { id: true, poNumber: true, vendor: true },
    });
    if (!conflict || conflict.id === excludeId) return ok({ conflict: null });
    return ok({ conflict });
  } catch (err) {
    return toErrorResponse(err);
  }
}
