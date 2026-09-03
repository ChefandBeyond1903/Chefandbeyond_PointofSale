import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { requireScopedUser, scopeStoreId } from "@/lib/scope";
import { vendorCreateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET() {
  try {
    const actor = await requireScopedUser();
    const scoped = scopeStoreId(actor); // a manager's store, or null for an admin

    const [vendors, counts, invRows, products] = await Promise.all([
      prisma.vendor.findMany({ orderBy: { name: "asc" } }),
      // How many products currently carry each vendor name.
      prisma.product.groupBy({ by: ["vendor"], _count: { _all: true } }),
      // On-hand per product (the caller's store, or every store for an admin).
      prisma.storeInventory.groupBy({
        by: ["productId"],
        where: scoped ? { storeId: scoped } : {},
        _sum: { quantity: true },
      }),
      prisma.product.findMany({ select: { id: true, vendor: true, trackStock: true } }),
    ]);

    const byName = new Map(counts.map((c) => [c.vendor, c._count._all]));
    const productById = new Map(products.map((p) => [p.id, p]));

    // Distinct products with a positive on-hand quantity, per vendor.
    const inStock = new Map<string, number>();
    for (const r of invRows) {
      if ((r._sum.quantity ?? 0) <= 0) continue;
      const p = productById.get(r.productId);
      if (!p || !p.trackStock || !p.vendor) continue;
      inStock.set(p.vendor, (inStock.get(p.vendor) ?? 0) + 1);
    }

    return ok({
      vendors: vendors.map((v) => ({
        ...v,
        productCount: byName.get(v.name) ?? 0,
        inStockProductCount: inStock.get(v.name) ?? 0,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const data = vendorCreateSchema.parse(await req.json());
    const vendor = await prisma.vendor.create({ data });
    return ok({ vendor }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
