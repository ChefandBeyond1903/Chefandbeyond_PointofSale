import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { cardFeeCents } from "@/lib/money";
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
    const user = await requireScopedRole("CASHIER", "MANAGER", "ADMIN");
    // Cashiers get a cut-down report: top products and invoices only, no money.
    const limited = user.role === "CASHIER";
    const { searchParams } = new URL(req.url);
    const now = new Date();
    const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : startOfDay(now);
    const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;

    // Store scope: a manager is pinned to their store; an admin sees every store
    // unless they pick one with ?storeId=.
    const scoped = scopeStoreId(user);
    const requestedStore = searchParams.get("storeId")?.trim() || null;
    const storeId = scoped ?? requestedStore;

    // A sale counts for the period it was PAID in, not when it was rung — an
    // unpaid invoice isn't revenue until the money comes in.
    const where: Prisma.SaleWhereInput = {
      status: "COMPLETED",
      paidAt: { gte: from, lte: to },
    };
    if (storeId) where.storeId = storeId;

    const [sales, stores] = await Promise.all([
      prisma.sale.findMany({
        where,
        orderBy: { paidAt: "desc" },
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
          salespersonId: true,
          salesperson: { select: { name: true } },
          items: {
            select: {
              productId: true,
              nameSnapshot: true,
              skuSnapshot: true,
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

    // Outstanding invoices (not paid yet) — a receivable, shown regardless of
    // the date range. Cashiers don't see money figures, so skip it for them.
    const unpaidRows = limited
      ? []
      : await prisma.sale.findMany({
          where: { status: "INVOICED", ...(storeId ? { storeId } : {}) },
          orderBy: { dueDate: "asc" },
          select: {
            id: true,
            number: true,
            createdAt: true,
            dueDate: true,
            totalCents: true,
            amountPaidCents: true,
            termsSnapshot: true,
            customerNameSnapshot: true,
          },
        });
    const now2 = new Date();
    const unpaidInvoices = unpaidRows.map((s) => ({
      id: s.id,
      number: s.number,
      invoicedAt: s.createdAt.toISOString(),
      dueDate: s.dueDate ? s.dueDate.toISOString() : null,
      terms: s.termsSnapshot,
      customer: s.customerNameSnapshot || "",
      totalCents: s.totalCents,
      paidCents: s.amountPaidCents,
      balanceCents: s.totalCents - s.amountPaidCents,
      overdue: !!s.dueDate && s.dueDate < now2,
    }));
    const receivables = {
      count: unpaidInvoices.length,
      // Money still owed to us (balance, net of deposits already taken).
      amountCents: unpaidInvoices.reduce((s, i) => s + i.balanceCents, 0),
      // Customer deposits held against open orders — a liability, not revenue.
      depositsHeldCents: unpaidInvoices.reduce((s, i) => s + i.paidCents, 0),
      overdueCount: unpaidInvoices.filter((i) => i.overdue).length,
    };

    // Refunds issued in the window (any method) reduce net profit for the period.
    const refundAgg = limited
      ? null
      : await prisma.saleRefund.aggregate({
          where: {
            refundedAt: { gte: from, lte: to },
            ...(storeId ? { sale: { storeId } } : {}),
          },
          _sum: { amountCents: true },
          _count: true,
        });
    const refundsCents = refundAgg?._sum.amountCents ?? 0;

    // Store credit customers are holding — a liability. Not date-scoped.
    const creditAgg = limited
      ? null
      : await prisma.customer.aggregate({ _sum: { storeCreditCents: true } });
    const storeCreditOutstandingCents = creditAgg?._sum.storeCreditCents ?? 0;

    // Operating expenses in the same window and store scope, for the P&L.
    const expenseWhere: Prisma.ExpenseWhereInput = {
      expenseDate: { gte: from, lte: to },
    };
    if (storeId) expenseWhere.storeId = storeId;
    const expenseRows = limited
      ? []
      : await prisma.expense.groupBy({
          by: ["category"],
          where: expenseWhere,
          _sum: { amountCents: true },
        });
    const expensesByCategory = expenseRows.map((r) => ({
      category: r.category,
      amountCents: r._sum.amountCents ?? 0,
    }));
    // Card-processing fee (3% of the ticket total on every card sale) is added
    // below once the card total is known from the sales loop.

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
    const byProduct = new Map<
      string,
      { name: string; sku: string; quantity: number; revenueCents: number }
    >();

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
          sku: it.skuSnapshot,
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

      // Credit the salesperson (falls back to the cashier for legacy rows).
      const staffId = s.salespersonId ?? s.cashierId;
      const staffName = s.salesperson?.name ?? s.cashier?.name ?? "—";
      const staff = byStaff.get(staffId) ?? {
        label: staffName,
        saleCount: 0,
        net: 0,
        cost: 0,
        profit: 0,
      };
      staff.saleCount += 1;
      staff.net += saleNet;
      staff.cost += saleCost;
      staff.profit += saleNet - saleCost;
      byStaff.set(staffId, staff);

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
          salesperson: s.salesperson?.name ?? s.cashier?.name ?? "—",
          store: storeLabel,
          storeId: s.storeId ?? null,
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

    // Operating expenses = the real expense categories only. The 3% card-
    // processing fee is tracked on its own line, not lumped in here.
    expensesByCategory.sort((a, b) => b.amountCents - a.amountCents);
    const expensesCents = expensesByCategory.reduce((s, e) => s + e.amountCents, 0);
    const cardSalesCents = byMethod.get("CARD")?.totalCents ?? 0;
    const cardFeeCentsTotal = limited ? 0 : cardFeeCents(cardSalesCents);

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

    const topProducts = [...byProduct.entries()]
      .map(([productId, v]) => ({ productId, ...v }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    // A cashier's report carries no money figures — only counts, top sellers
    // and the invoice list (with per-invoice profit stripped).
    if (limited) {
      return ok({
        range: { from: from.toISOString(), to: to.toISOString() },
        scope: {
          allStores: false,
          storeId: storeId ?? null,
          storeName: storeId ? (storeNameById.get(storeId) ?? null) : null,
        },
        stores: [],
        limited: true,
        totals: {
          saleCount,
          grossCents: 0,
          subtotalCents: 0,
          taxCents: 0,
          discountCents: 0,
          costCents: 0,
          profitCents: 0,
          marginPct: 0,
          itemsSold,
          averageSaleCents: 0,
          expensesCents: 0,
          cardSalesCents: 0,
          cardFeeCents: 0,
          refundsCents: 0,
          storeCreditOutstandingCents: 0,
          netProfitCents: 0,
        },
        expensesByCategory: [],
        byStore: [],
        byStaff: [],
        byPaymentMethod: [],
        topProducts,
        recentSales: recentSales.map((s) => ({ ...s, profitCents: 0 })),
        receivables: { count: 0, amountCents: 0, depositsHeldCents: 0, overdueCount: 0 },
        unpaidInvoices: [],
      });
    }

    return ok({
      range: { from: from.toISOString(), to: to.toISOString() },
      scope: {
        allStores: !storeId,
        storeId: storeId ?? null,
        storeName: storeId ? (storeNameById.get(storeId) ?? null) : null,
      },
      stores: user.role === "ADMIN" ? stores : [],
      limited: false,
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
        expensesCents,
        cardSalesCents,
        cardFeeCents: cardFeeCentsTotal,
        refundsCents,
        storeCreditOutstandingCents,
        netProfitCents: profitCents - expensesCents - cardFeeCentsTotal - refundsCents,
      },
      expensesByCategory,
      byStore: toRows(byStore),
      byStaff: toRows(byStaff),
      byPaymentMethod: [...byMethod.entries()].map(([method, v]) => ({
        method,
        count: v.count,
        totalCents: v.totalCents,
      })),
      topProducts,
      recentSales,
      receivables,
      unpaidInvoices,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
