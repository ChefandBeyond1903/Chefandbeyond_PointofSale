import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireScopedUser, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status")?.trim();
    const vendor = searchParams.get("vendor")?.trim();
    const poId = searchParams.get("poId")?.trim();
    const overdue = searchParams.get("overdue") === "1";

    const where: Prisma.BillWhereInput = {};
    const scoped = scopeStoreId(actor);
    if (scoped) where.storeId = scoped;
    if (status === "OPEN" || status === "PAID") where.status = status;
    if (vendor) where.vendor = vendor;
    if (poId) where.poId = poId;
    if (overdue) {
      where.status = "OPEN";
      where.dueDate = { lt: new Date() };
    }

    const bills = await prisma.bill.findMany({
      where,
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { billDate: "desc" }],
      take: 500,
      include: {
        po: { select: { id: true, poNumber: true } },
        store: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });
    return ok({ bills });
  } catch (err) {
    return toErrorResponse(err);
  }
}
