import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScopedRole } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

// A missing / unparseable timestamp means "no baseline yet" — treat it as now so
// nothing counts as new until the client has recorded when it last looked.
function since(v: string | null): Date {
  if (!v) return new Date();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

// How many rows were created in each admin-facing section since the caller last
// viewed it. Drives the "new" badges in the nav. Admin only.
export async function GET(req: NextRequest) {
  try {
    await requireScopedRole("ADMIN");
    const { searchParams } = new URL(req.url);

    const [vendors, customers, purchaseOrders, bills, users] = await Promise.all([
      prisma.vendor.count({ where: { createdAt: { gt: since(searchParams.get("vendors")) } } }),
      prisma.customer.count({ where: { createdAt: { gt: since(searchParams.get("customers")) } } }),
      prisma.purchaseOrder.count({
        where: { createdAt: { gt: since(searchParams.get("purchaseOrders")) } },
      }),
      prisma.bill.count({ where: { createdAt: { gt: since(searchParams.get("bills")) } } }),
      prisma.user.count({ where: { createdAt: { gt: since(searchParams.get("users")) } } }),
    ]);

    return ok({ vendors, customers, purchaseOrders, bills, users });
  } catch (err) {
    return toErrorResponse(err);
  }
}
