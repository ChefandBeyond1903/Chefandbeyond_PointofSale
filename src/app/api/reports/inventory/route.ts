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
          product: {
            select: { name: true, sku: true, vendor: true, costCents: true, priceCents: true },
          },
        },
      }),
      user.role === "ADMIN"
        ? prisma.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);

    type ProdAgg = {
      productId: string;
      name: string;
      sku: string;
      quantity: number;
      costCents: number;
      retailCents: number;
    };
    // vendor -> (productId -> aggregated line). Stock for one product can span
    // several stores, so it's summed per product before grouping by vendor.
    const byVendorMap = new Map<string, Map<string, ProdAgg>>();
    for (const r of rows) {
      const vendor = r.product.vendor?.trim() || "— No vendor —";
      const products = byVendorMap.get(vendor) ?? new Map<string, ProdAgg>();
      const line =
        products.get(r.productId) ??
        {
          productId: r.productId,
          name: r.product.name,
          sku: r.product.sku,
          quantity: 0,
          costCents: 0,
          retailCents: 0,
        };
      line.quantity += r.quantity;
      line.costCents += r.quantity * r.product.costCents;
      line.retailCents += r.quantity * r.product.priceCents;
      products.set(r.productId, line);
      byVendorMap.set(vendor, products);
    }

    const byVendor = [...byVendorMap.entries()]
      .map(([vendor, products]) => {
        const items = [...products.values()]
          .filter((p) => p.quantity !== 0 || p.costCents !== 0)
          .sort((a, b) => b.costCents - a.costCents);
        return {
          vendor,
          productCount: items.length,
          quantity: items.reduce((s, p) => s + p.quantity, 0),
          costCents: items.reduce((s, p) => s + p.costCents, 0),
          retailCents: items.reduce((s, p) => s + p.retailCents, 0),
          items,
        };
      })
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
