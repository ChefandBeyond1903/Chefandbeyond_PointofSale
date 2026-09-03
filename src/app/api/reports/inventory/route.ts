import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

// Inventory valuation: current on-hand stock grouped by vendor, valued at the
// product's unit cost (and, for reference, its selling price). A manager sees
// their own store; an admin sees every store unless they pass ?storeId=.
export async function GET(req: NextRequest) {
  try {
    const user = await requireScopedRole("MANAGER", "ADMIN");
    const { searchParams } = new URL(req.url);

    const scoped = scopeStoreId(user);
    const requestedStore = searchParams.get("storeId")?.trim() || null;
    const storeId = scoped ?? requestedStore;

    const [rows, stores] = await Promise.all([
      prisma.storeInventory.findMany({
        where: {
          ...(storeId ? { storeId } : {}),
          product: { trackStock: true },
        },
        select: {
          productId: true,
          quantity: true,
          product: { select: { vendor: true, costCents: true, priceCents: true } },
        },
      }),
      user.role === "ADMIN"
        ? prisma.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);

    type Agg = {
      quantity: number;
      costCents: number;
      retailCents: number;
      products: Set<string>;
    };
    const byVendorMap = new Map<string, Agg>();
    for (const r of rows) {
      const vendor = r.product.vendor?.trim() || "— No vendor —";
      const a =
        byVendorMap.get(vendor) ??
        { quantity: 0, costCents: 0, retailCents: 0, products: new Set<string>() };
      a.quantity += r.quantity;
      a.costCents += r.quantity * r.product.costCents;
      a.retailCents += r.quantity * r.product.priceCents;
      a.products.add(r.productId);
      byVendorMap.set(vendor, a);
    }

    const byVendor = [...byVendorMap.entries()]
      .map(([vendor, a]) => ({
        vendor,
        productCount: a.products.size,
        quantity: a.quantity,
        costCents: a.costCents,
        retailCents: a.retailCents,
      }))
      // Skip vendors whose on-hand nets to nothing of value.
      .filter((v) => v.quantity !== 0 || v.costCents !== 0)
      .sort((x, y) => y.costCents - x.costCents);

    const totals = byVendor.reduce(
      (t, v) => ({
        productCount: t.productCount + v.productCount,
        quantity: t.quantity + v.quantity,
        costCents: t.costCents + v.costCents,
        retailCents: t.retailCents + v.retailCents,
      }),
      { productCount: 0, quantity: 0, costCents: 0, retailCents: 0 },
    );

    const storeName = storeId
      ? (stores.find((s) => s.id === storeId)?.name ??
          (await prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }))?.name ??
          null)
      : null;

    return ok({
      generatedAt: new Date().toISOString(),
      scope: { allStores: !storeId, storeId: storeId ?? null, storeName },
      stores: user.role === "ADMIN" ? stores : [],
      byVendor,
      totals,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
