import { prisma } from "@/lib/prisma";
import { requireScopedRole } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

type Win = { count: number; grossCents: number; profitCents: number; itemsSold: number };
const emptyWin = (): Win => ({ count: 0, grossCents: 0, profitCents: 0, itemsSold: 0 });

// A single snapshot for the admin Overview page. Admin only.
export async function GET() {
  try {
    await requireScopedRole("ADMIN");

    const now = new Date();
    const startToday = startOfDay(now);
    const startWeek = startOfDay(addDays(now, -now.getDay())); // Sunday
    const startMonth = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));

    const [
      monthSales,
      monthExpenseAgg,
      openBillAgg,
      overdueBillAgg,
      openPoCount,
      heldCount,
      activeProducts,
      totalProducts,
      trackedProducts,
      invSums,
      vendorCount,
      customerCount,
      staffCount,
      storeCount,
      recentSales,
      recentExpenses,
    ] = await Promise.all([
      prisma.sale.findMany({
        where: { status: "COMPLETED", createdAt: { gte: startMonth, lte: now } },
        orderBy: { createdAt: "desc" },
        select: {
          createdAt: true,
          storeId: true,
          storeNameSnapshot: true,
          totalCents: true,
          items: {
            select: {
              productId: true,
              nameSnapshot: true,
              quantity: true,
              unitPriceCents: true,
              unitCostCents: true,
              discountCents: true,
            },
          },
        },
      }),
      prisma.expense.aggregate({
        where: { expenseDate: { gte: startMonth, lte: now } },
        _sum: { amountCents: true },
      }),
      prisma.bill.aggregate({ where: { status: "OPEN" }, _sum: { subtotalCents: true }, _count: true }),
      prisma.bill.aggregate({
        where: { status: "OPEN", dueDate: { lt: now } },
        _sum: { subtotalCents: true },
        _count: true,
      }),
      prisma.purchaseOrder.count({ where: { status: { in: ["OPEN", "SENT", "PARTIAL"] } } }),
      prisma.heldSale.count(),
      prisma.product.count({ where: { active: true } }),
      prisma.product.count(),
      prisma.product.findMany({
        where: { active: true, trackStock: true },
        select: { id: true },
      }),
      prisma.storeInventory.groupBy({ by: ["productId"], _sum: { quantity: true } }),
      prisma.vendor.count(),
      prisma.customer.count(),
      prisma.user.count({ where: { active: true } }),
      prisma.store.count({ where: { active: true } }),
      prisma.sale.findMany({
        where: { status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          number: true,
          createdAt: true,
          totalCents: true,
          storeNameSnapshot: true,
          customerNameSnapshot: true,
          salesperson: { select: { name: true } },
          cashier: { select: { name: true } },
        },
      }),
      prisma.expense.findMany({
        orderBy: { expenseDate: "desc" },
        take: 5,
        select: {
          id: true,
          category: true,
          payee: true,
          amountCents: true,
          expenseDate: true,
          store: { select: { name: true } },
        },
      }),
    ]);

    // Roll the month's sales into today / week / month windows.
    const today = emptyWin();
    const week = emptyWin();
    const month = emptyWin();
    const byStoreMap = new Map<string, { label: string; grossCents: number; profitCents: number }>();
    const byProductMap = new Map<string, { name: string; quantity: number; revenueCents: number }>();

    for (const s of monthSales) {
      let net = 0;
      let cost = 0;
      let qty = 0;
      for (const it of s.items) {
        net += it.unitPriceCents * it.quantity - it.discountCents;
        cost += it.unitCostCents * it.quantity;
        qty += it.quantity;
        const p = byProductMap.get(it.productId) ?? {
          name: it.nameSnapshot,
          quantity: 0,
          revenueCents: 0,
        };
        p.quantity += it.quantity;
        p.revenueCents += it.unitPriceCents * it.quantity - it.discountCents;
        byProductMap.set(it.productId, p);
      }
      const profit = net - cost;

      const add = (w: Win) => {
        w.count += 1;
        w.grossCents += s.totalCents;
        w.profitCents += profit;
        w.itemsSold += qty;
      };
      add(month);
      if (s.createdAt >= startWeek) add(week);
      if (s.createdAt >= startToday) add(today);

      const key = s.storeId ?? "unassigned";
      const st = byStoreMap.get(key) ?? {
        label: s.storeNameSnapshot || "Unassigned",
        grossCents: 0,
        profitCents: 0,
      };
      st.grossCents += s.totalCents;
      st.profitCents += profit;
      byStoreMap.set(key, st);
    }

    const invByProduct = new Map(invSums.map((r) => [r.productId, r._sum.quantity ?? 0]));
    let outOfStock = 0;
    for (const p of trackedProducts) if ((invByProduct.get(p.id) ?? 0) <= 0) outOfStock += 1;

    const monthExpensesCents = monthExpenseAgg._sum.amountCents ?? 0;

    return ok({
      generatedAt: now.toISOString(),
      sales: { today, week, month },
      month: {
        expensesCents: monthExpensesCents,
        netProfitCents: month.profitCents - monthExpensesCents,
      },
      payables: {
        openBills: {
          count: openBillAgg._count,
          amountCents: openBillAgg._sum.subtotalCents ?? 0,
        },
        overdueBills: {
          count: overdueBillAgg._count,
          amountCents: overdueBillAgg._sum.subtotalCents ?? 0,
        },
        openPurchaseOrders: openPoCount,
      },
      operations: {
        heldTickets: heldCount,
        outOfStock,
        activeProducts,
        totalProducts,
      },
      directory: {
        vendors: vendorCount,
        customers: customerCount,
        staff: staffCount,
        stores: storeCount,
      },
      byStore: [...byStoreMap.values()].sort((a, b) => b.grossCents - a.grossCents),
      topProducts: [...byProductMap.entries()]
        .map(([productId, v]) => ({ productId, ...v }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5),
      recentSales: recentSales.map((s) => ({
        id: s.id,
        number: s.number,
        createdAt: s.createdAt.toISOString(),
        totalCents: s.totalCents,
        store: s.storeNameSnapshot || "",
        who: s.customerNameSnapshot || s.salesperson?.name || s.cashier?.name || "—",
      })),
      recentExpenses: recentExpenses.map((e) => ({
        id: e.id,
        category: e.category,
        payee: e.payee,
        amountCents: e.amountCents,
        expenseDate: e.expenseDate.toISOString(),
        store: e.store?.name ?? "Company-wide",
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
