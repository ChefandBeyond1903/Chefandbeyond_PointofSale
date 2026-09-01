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
    const q = searchParams.get("q")?.trim();
    const storeParam = searchParams.get("storeId")?.trim();
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const where: Prisma.BillWhereInput = {};
    const scoped = scopeStoreId(actor);
    if (scoped) where.storeId = scoped;
    else if (storeParam) where.storeId = storeParam; // admin: filter to one store
    if (status === "OPEN" || status === "PAID") where.status = status;
    if (vendor) where.vendor = vendor;
    if (poId) where.poId = poId;
    if (from || to) {
      where.billDate = {};
      if (from) where.billDate.gte = new Date(from);
      if (to) where.billDate.lte = new Date(to);
    }
    if (overdue) {
      where.status = "OPEN";
      where.dueDate = { lt: new Date() };
    }

    // Free-text search across everything on the bill — header, PO, store, memo,
    // terms, line items, and (when it parses as money) the amount.
    if (q) {
      const or: Prisma.BillWhereInput[] = [
        { billNumber: { contains: q } },
        { vendor: { contains: q } },
        { memo: { contains: q } },
        { terms: { contains: q } },
        { po: { poNumber: { contains: q } } },
        { store: { name: { contains: q } } },
        { createdBy: { name: { contains: q } } },
        {
          items: {
            some: {
              OR: [{ nameSnapshot: { contains: q } }, { skuSnapshot: { contains: q } }],
            },
          },
        },
      ];
      const money = Number.parseFloat(q.replace(/[$,\s]/g, ""));
      if (Number.isFinite(money)) {
        const cents = Math.round(money * 100);
        or.push({ subtotalCents: cents });
        or.push({ subtotalCents: { gte: cents, lt: cents + 100 } }); // whole-dollar match
        or.push({ items: { some: { unitCostCents: cents } } });
      }
      where.OR = or;
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
