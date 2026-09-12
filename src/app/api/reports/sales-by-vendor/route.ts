import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

// Sold quantity and cost, grouped by the vendor snapshotted on each sale line
// at the time of sale — independent of whether that vendor is still in the
// Product record or the Vendor directory today. Money-sensitive: manager/
// admin only, same as the rest of Reports' dollar figures.
export async function GET(req: NextRequest) {
  try {
    const user = await requireScopedRole("MANAGER", "ADMIN");
    const { searchParams } = new URL(req.url);
    const now = new Date();
    const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : now;
    const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;

    const scoped = scopeStoreId(user);
    const requestedStore = searchParams.get("storeId")?.trim() || null;
    const storeId = user.role === "ADMIN" ? requestedStore : scoped;
    const noStoreAssigned = scoped === "__none__";

    const where: Prisma.SaleWhereInput = {
      status: "COMPLETED",
      paidAt: { gte: from, lte: to },
    };
    if (storeId) where.storeId = storeId;

    const [sales, stores, vendors] = await Promise.all([
      noStoreAssigned
        ? Promise.resolve([])
        : prisma.sale.findMany({
            where,
            select: {
              items: {
                select: {
                  vendorSnapshot: true,
                  quantity: true,
                  unitCostCents: true,
                  unitPriceCents: true,
                  discountCents: true,
                },
              },
            },
          }),
      prisma.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.vendor.findMany({ select: { name: true, rebateBps: true } }),
    ]);

    const rebateByVendor = new Map(vendors.map((v) => [v.name.trim().toLowerCase(), v.rebateBps]));

    const byVendor = new Map<string, { quantity: number; costCents: number; revenueCents: number }>();
    for (const s of sales) {
      for (const it of s.items) {
        const vendor = it.vendorSnapshot?.trim() || "Unassigned";
        const row = byVendor.get(vendor) ?? { quantity: 0, costCents: 0, revenueCents: 0 };
        row.quantity += it.quantity;
        row.costCents += it.quantity * it.unitCostCents;
        row.revenueCents += it.unitPriceCents * it.quantity - it.discountCents;
        byVendor.set(vendor, row);
      }
    }

    // Rebate is a percentage of what we paid the vendor, not what we sold for.
    const rows = [...byVendor.entries()]
      .map(([vendor, v]) => {
        const rebateBps = rebateByVendor.get(vendor.trim().toLowerCase()) ?? 0;
        return {
          vendor,
          quantity: v.quantity,
          revenueCents: v.revenueCents,
          costCents: v.costCents,
          rebateBps,
          rebateCents: Math.round((v.costCents * rebateBps) / 10_000),
        };
      })
      .sort((a, b) => b.revenueCents - a.revenueCents);

    const totals = rows.reduce(
      (t, r) => ({
        quantity: t.quantity + r.quantity,
        revenueCents: t.revenueCents + r.revenueCents,
        costCents: t.costCents + r.costCents,
        rebateCents: t.rebateCents + r.rebateCents,
      }),
      { quantity: 0, revenueCents: 0, costCents: 0, rebateCents: 0 },
    );

    const storeName = storeId ? (stores.find((s) => s.id === storeId)?.name ?? "") : "";

    return ok({
      range: { from: from.toISOString(), to: to.toISOString() },
      scope: {
        allStores: user.role === "ADMIN" && !storeId,
        storeName: storeId ? storeName : null,
        noStoreAssigned,
      },
      stores,
      rows,
      totals,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
