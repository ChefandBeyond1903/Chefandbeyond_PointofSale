import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function pct(profit: number, net: number): number {
  return net > 0 ? Math.round((profit / net) * 1000) / 10 : 0;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireScopedRole("MANAGER", "ADMIN");
    const { searchParams } = new URL(req.url);
    const now = new Date();
    const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : startOfDay(now);
    const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;

    // Store scope: a manager is pinned to their store; an admin sees every store
    // unless they pick one with ?storeId=.
    const scoped = scopeStoreId(user);
    const requestedStore = searchParams.get("storeId")?.trim() || null;
    const storeId = scoped ?? requestedStore;

    const where: Prisma.SaleWhereInput = {
      status: "COMPLETED",
      createdAt: { gte: from, lte: to },
    };
    if (storeId) where.storeId = storeId;

    const [sales, stores] = await Promise.all([
      prisma.sale.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          number: true,
          createdAt: true,
          storeId: true,
          storeNameSnapshot: true,
          paymentMethod: true,
          subtotalCents: true,
          taxCents: true,
          discountCents: true,
          totalCents: true,
          customerNameSnapshot: true,
          cashierId: true,
          cashier: { select: { name: true } },
          items: {
            select: {
              productId: true,
              nameSnapshot: true,
              quantity: true,
              unitPriceCents: true,
              unitCostCents: true,
              discountCents: true,
              lineTotalCents: true,
            },
          },
        },
      }),
      prisma.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);

    const storeNameById = new Map(stores.map((s) => [s.id, s.name]));

    let grossCents = 0;
    let subtotalCents = 0;
    let taxCents = 0;
    let discountCents = 0;
    let itemsSold = 0;
    let netCents = 0; // ex-tax revenue after every discount
    let costCents = 0;

    const byStore = new Map<
      string,
      { label: string; saleCount: number; net: number; cost: number; profit: number }
    >();
    const byStaff = new Map<
      string,
      { label: string; saleCount: number; net: number; cost: number; profit: number }
    >();
    const byMethod = new Map<string, { count: number; totalCents: number }>();
    const byProduct = new Map<string, { name: string; quantity: number; revenueCents: number }>();

    const recentSales = [];

    for (const s of sales) {
      grossCents += s.totalCents;
      subtotalCents += s.subtotalCents;
      taxCents += s.taxCents;
      discountCents += s.discountCents;

      let saleNet = 0;
      let saleCost = 0;
      for (const it of s.items) {
        const lineNet = it.unitPriceCents * it.quantity - it.discountCents;
        const lineCost = it.unitCostCents * it.quantity;
        saleNet += lineNet;
        saleCost += lineCost;
        itemsSold += it.quantity;

        const p = byProduct.get(it.productId) ?? {
          name: it.nameSnapshot,
          quantity: 0,
          revenueCents: 0,
        };
        p.quantity += it.quantity;
        p.revenueCents += it.lineTotalCents;
        byProduct.set(it.productId, p);
      }
      netCents += saleNet;
      costCents += saleCost;

      const storeKey = s.storeId ?? "unassigned";
      const storeLabel = s.storeNameSnapshot || storeNameById.get(s.storeId ?? "") || "Unassigned";
      const st = byStore.get(storeKey) ?? {
        label: storeLabel,
        saleCount: 0,
        net: 0,
        cost: 0,
        profit: 0,
      };
      st.saleCount += 1;
      st.net += saleNet;
      st.cost += saleCost;
      st.profit += saleNet - saleCost;
      byStore.set(storeKey, st);

      const staff = byStaff.get(s.cashierId) ?? {
        label: s.cashier?.name ?? "—",
        saleCount: 0,
        net: 0,
        cost: 0,
        profit: 0,
      };
      staff.saleCount += 1;
      staff.net += saleNet;
      staff.cost += saleCost;
      staff.profit += saleNet - saleCost;
      byStaff.set(s.cashierId, staff);

      const m = byMethod.get(s.paymentMethod) ?? { count: 0, totalCents: 0 };
      m.count += 1;
      m.totalCents += s.totalCents;
      byMethod.set(s.paymentMethod, m);

      if (recentSales.length < 100) {
        recentSales.push({
          id: s.id,
          number: s.number,
          createdAt: s.createdAt.toISOString(),
          cashier: s.cashier?.name ?? "—",
          store: storeLabel,
          customer: s.customerNameSnapshot || "",
          paymentMethod: s.paymentMethod,
          itemCount: s.items.reduce((sum, i) => sum + i.quantity, 0),
          totalCents: s.totalCents,
          profitCents: saleNet - saleCost,
        });
      }
    }

    const profitCents = netCents - costCents;
    const saleCount = sales.length;

    const toRows = (
      m: Map<string, { label: string; saleCount: number; net: number; cost: number; profit: number }>,
    ) =>
      [...m.entries()]
        .map(([key, v]) => ({
          key,
          label: v.label,
          saleCount: v.saleCount,
          netCents: v.net,
          costCents: v.cost,
          profitCents: v.profit,
          marginPct: pct(v.profit, v.net),
        }))
        .sort((a, b) => b.profitCents - a.profitCents);

    return ok({
      range: { from: from.toISOString(), to: to.toISOString() },
      scope: {
        allStores: !storeId,
        storeId: storeId ?? null,
        storeName: storeId ? (storeNameById.get(storeId) ?? null) : null,
      },
      stores: user.role === "ADMIN" ? stores : [],
      totals: {
        saleCount,
        grossCents,
        subtotalCents,
        taxCents,
        discountCents,
        costCents,
        profitCents,
        marginPct: pct(profitCents, netCents),
        itemsSold,
        averageSaleCents: saleCount > 0 ? Math.round(grossCents / saleCount) : 0,
      },
      byStore: toRows(byStore),
      byStaff: toRows(byStaff),
      byPaymentMethod: [...byMethod.entries()].map(([method, v]) => ({
        method,
        count: v.count,
        totalCents: v.totalCents,
      })),
      topProducts: [...byProduct.entries()]
        .map(([productId, v]) => ({ productId, ...v }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10),
      recentSales,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
