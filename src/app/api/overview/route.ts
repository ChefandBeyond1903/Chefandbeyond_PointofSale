import { prisma } from "@/lib/prisma";
import { requireScopedRole } from "@/lib/scope";
import { cardFeeCents } from "@/lib/money";
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
      overduePoAgg,
      posDue,
      unpaidInvoiceAgg,
      overdueInvoiceAgg,
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
        // A sale counts for the day it was paid, not rung.
        where: { status: "COMPLETED", paidAt: { gte: startMonth, lte: now } },
        orderBy: { paidAt: "desc" },
        select: {
          createdAt: true,
          paidAt: true,
          storeId: true,
          storeNameSnapshot: true,
          totalCents: true,
          paymentMethod: true,
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
      prisma.purchaseOrder.aggregate({
        where: { status: { in: ["OPEN", "SENT", "PARTIAL"] }, dueDate: { lt: now } },
        _sum: { subtotalCents: true },
        _count: true,
      }),
      prisma.purchaseOrder.findMany({
        where: { status: { in: ["OPEN", "SENT", "PARTIAL"] }, dueDate: { not: null } },
        orderBy: { dueDate: "asc" },
        take: 6,
        select: { id: true, poNumber: true, vendor: true, dueDate: true, subtotalCents: true },
      }),
      prisma.sale.aggregate({
        where: { status: "INVOICED" },
        _sum: { totalCents: true, amountPaidCents: true },
        _count: true,
      }),
      prisma.sale.aggregate({
        where: { status: "INVOICED", dueDate: { lt: now } },
        _sum: { totalCents: true, amountPaidCents: true },
        _count: true,
      }),
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
    let monthCardGrossCents = 0;
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
      const when = s.paidAt ?? s.createdAt;
      add(month);
      if (when >= startWeek) add(week);
      if (when >= startToday) add(today);
      if (s.paymentMethod === "CARD") monthCardGrossCents += s.totalCents;

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
    const monthCardFeeCents = cardFeeCents(monthCardGrossCents);

    return ok({
      generatedAt: now.toISOString(),
      sales: { today, week, month },
      month: {
        expensesCents: monthExpensesCents,
        cardFeeCents: monthCardFeeCents,
        netProfitCents: month.profitCents - monthExpensesCents - monthCardFeeCents,
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
        overduePurchaseOrders: {
          count: overduePoAgg._count,
          amountCents: overduePoAgg._sum.subtotalCents ?? 0,
        },
      },
      receivables: {
        unpaidInvoices: {
          count: unpaidInvoiceAgg._count,
          // Balance still owed, net of deposits already taken.
          amountCents:
            (unpaidInvoiceAgg._sum.totalCents ?? 0) -
            (unpaidInvoiceAgg._sum.amountPaidCents ?? 0),
        },
        overdueInvoices: {
          count: overdueInvoiceAgg._count,
          amountCents:
            (overdueInvoiceAgg._sum.totalCents ?? 0) -
            (overdueInvoiceAgg._sum.amountPaidCents ?? 0),
        },
        depositsHeldCents: unpaidInvoiceAgg._sum.amountPaidCents ?? 0,
      },
      purchaseOrdersDue: posDue.map((p) => ({
        id: p.id,
        poNumber: p.poNumber,
        vendor: p.vendor,
        dueDate: (p.dueDate as Date).toISOString(),
        totalCents: p.subtotalCents,
        overdue: (p.dueDate as Date) < now,
      })),
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
