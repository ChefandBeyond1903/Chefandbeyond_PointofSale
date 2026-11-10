import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";
import { effectiveGroup, rebateBpsFor, type BuyingGroup } from "@/lib/buyingGroup";

// Sold quantity and cost, grouped by vendor. Normally the vendor snapshotted
// on the sale line at the time of sale (so correcting a product's vendor
// later doesn't rewrite an already-reported period) — except a line rung
// before its product had a vendor set at all carries an empty snapshot
// forever, so that one case falls back to the product's current vendor (same
// rule used when raising a PO from an invoice — see sales/[id]/purchase-
// orders/route.ts). Money-sensitive: manager/admin only, same as the rest of
// Reports' dollar figures.
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
                  productId: true,
                  nameSnapshot: true,
                  skuSnapshot: true,
                  vendorSnapshot: true,
                  quantity: true,
                  unitCostCents: true,
                  unitPriceCents: true,
                  discountCents: true,
                  product: { select: { vendor: true, excludeFromRebate: true, buyingGroup: true } },
                },
              },
            },
          }),
      prisma.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.vendor.findMany({
        select: {
          name: true,
          rebateBps: true,
          usaFedRebateBps: true,
          strataBuyingGroup: true,
          usaFedBuyingGroup: true,
        },
      }),
    ]);

    const vendorByName = new Map(vendors.map((v) => [v.name.trim().toLowerCase(), v]));

    // One row per vendor per buying group, so a vendor bought through both
    // Strata and USA-FED has each group's rebate tracked on its own.
    const byVendor = new Map<
      string,
      {
        vendor: string;
        group: BuyingGroup | "";
        quantity: number;
        costCents: number;
        // Cost of lines that actually count toward the rebate — excludes any
        // product marked "exclude from rebate", even when its vendor pays one.
        rebateCostCents: number;
        revenueCents: number;
        items: Map<
          string,
          {
            name: string;
            sku: string;
            quantity: number;
            revenueCents: number;
            excludedFromRebate: boolean;
          }
        >;
      }
    >();
    for (const s of sales) {
      for (const it of s.items) {
        const vendor = it.vendorSnapshot?.trim() || it.product.vendor?.trim() || "Unassigned";
        const group = effectiveGroup(it.product.buyingGroup, vendorByName.get(vendor.toLowerCase()));
        const key = `${vendor}|${group}`;
        const row = byVendor.get(key) ?? {
          vendor,
          group,
          quantity: 0,
          costCents: 0,
          rebateCostCents: 0,
          revenueCents: 0,
          items: new Map<
            string,
            {
              name: string;
              sku: string;
              quantity: number;
              revenueCents: number;
              excludedFromRebate: boolean;
            }
          >(),
        };
        const lineRevenue = it.unitPriceCents * it.quantity - it.discountCents;
        const lineCost = it.quantity * it.unitCostCents;
        row.quantity += it.quantity;
        row.costCents += lineCost;
        row.revenueCents += lineRevenue;
        if (!it.product.excludeFromRebate) row.rebateCostCents += lineCost;
        const itemRow = row.items.get(it.productId) ?? {
          name: it.nameSnapshot,
          sku: it.skuSnapshot,
          quantity: 0,
          revenueCents: 0,
          excludedFromRebate: it.product.excludeFromRebate,
        };
        itemRow.quantity += it.quantity;
        itemRow.revenueCents += lineRevenue;
        row.items.set(it.productId, itemRow);
        byVendor.set(key, row);
      }
    }

    // Rebate is a percentage of what we paid the vendor for rebate-eligible
    // items, not the full cost of everything sold.
    const rows = [...byVendor.values()]
      .map((v) => {
        const rebateBps = rebateBpsFor(v.group, vendorByName.get(v.vendor.trim().toLowerCase()));
        return {
          vendor: v.vendor,
          group: v.group,
          quantity: v.quantity,
          revenueCents: v.revenueCents,
          costCents: v.costCents,
          rebateBps,
          rebateCents: Math.round((v.rebateCostCents * rebateBps) / 10_000),
          items: [...v.items.entries()]
            .map(([productId, i]) => ({ productId, ...i }))
            .sort((a, b) => b.revenueCents - a.revenueCents),
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
