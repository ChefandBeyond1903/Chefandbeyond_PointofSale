import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

// Splits completed sales into their KY/TN tax jurisdiction (tagged at sale
// time — see src/lib/taxJurisdiction.ts) for Kentucky DOR / Tennessee TNTAP
// filing. "Taxable sales" excludes tax-exempt sales (rung at 0%); "gross
// sales" includes them. Money-sensitive: manager/admin only.
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

    // Same filter as /api/reports/summary's P&L totals (status COMPLETED,
    // paidAt-based) so this report's KY + TN + unassigned always reconciles
    // exactly with the "sales tax collected" figure shown there.
    const where: Prisma.SaleWhereInput = {
      status: "COMPLETED",
      paidAt: { gte: from, lte: to },
    };
    if (storeId) where.storeId = storeId;

    const [sales, stores, overrideLogs] = await Promise.all([
      noStoreAssigned
        ? Promise.resolve([])
        : prisma.sale.findMany({
            where,
            select: {
              subtotalCents: true,
              discountCents: true,
              shippingCents: true,
              taxCents: true,
              taxJurisdiction: true,
              customerTaxExemptSnapshot: true,
            },
          }),
      prisma.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      noStoreAssigned
        ? Promise.resolve([])
        : prisma.taxOverrideLog.findMany({
            where: { createdAt: { gte: from, lte: to }, ...(storeId ? { sale: { storeId } } : {}) },
            orderBy: { createdAt: "desc" },
            take: 200,
            include: {
              sale: { select: { id: true, number: true } },
              changedBy: { select: { id: true, name: true } },
            },
          }),
    ]);

    function blank() {
      return { grossSalesCents: 0, taxableSalesCents: 0, taxCollectedCents: 0, saleCount: 0 };
    }
    // Every distinct jurisdiction tag seen — not just KY/TN — so a website
    // order manually taxed for, say, New York shows up as its own line.
    const buckets = new Map<string, ReturnType<typeof blank>>();
    for (const s of sales) {
      const grossCents = s.subtotalCents - s.discountCents + s.shippingCents;
      const key = s.taxJurisdiction || "UNASSIGNED";
      const bucket = buckets.get(key) ?? blank();
      bucket.grossSalesCents += grossCents;
      bucket.taxCollectedCents += s.taxCents;
      bucket.saleCount += 1;
      if (!s.customerTaxExemptSnapshot) bucket.taxableSalesCents += grossCents;
      buckets.set(key, bucket);
    }

    const ky = buckets.get("KY") ?? blank();
    const tn = buckets.get("TN") ?? blank();
    const unassigned = buckets.get("UNASSIGNED") ?? blank();
    // Any other state tagged manually (a website order taxed elsewhere),
    // listed separately and sorted alphabetically.
    const otherStates = [...buckets.entries()]
      .filter(([key]) => key !== "KY" && key !== "TN" && key !== "UNASSIGNED")
      .map(([state, v]) => ({ state, ...v }))
      .sort((a, b) => a.state.localeCompare(b.state));

    const allBuckets = [ky, tn, unassigned, ...otherStates];
    const total = allBuckets.reduce(
      (t, b) => ({
        grossSalesCents: t.grossSalesCents + b.grossSalesCents,
        taxableSalesCents: t.taxableSalesCents + b.taxableSalesCents,
        taxCollectedCents: t.taxCollectedCents + b.taxCollectedCents,
        saleCount: t.saleCount + b.saleCount,
      }),
      blank(),
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
      ky,
      tn,
      unassigned,
      otherStates,
      total,
      overrides: overrideLogs.map((l) => ({
        id: l.id,
        saleId: l.saleId,
        sale: l.sale,
        fromJurisdiction: l.fromJurisdiction,
        toJurisdiction: l.toJurisdiction,
        reason: l.reason,
        changedById: l.changedById,
        changedBy: l.changedBy,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
