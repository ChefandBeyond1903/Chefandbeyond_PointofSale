import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

// What we've actually paid each vendor, grouped by vendor — PAID bills only
// (an open/unpaid bill isn't money out the door yet), and only real vendor
// bills, never operating expenses. Grouped into the period by due date (or
// paid date when there's no due date), not by whenever it actually got paid.
// Money-sensitive: manager/admin only.
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

    // A bill counts for the period it was DUE, not when it happened to get
    // paid — a bill due in August that isn't paid until September still
    // belongs to August's report. Falls back to the paid date for a bill
    // with no due date at all (e.g. "due on receipt").
    const where: Prisma.BillWhereInput = { status: "PAID" };
    if (storeId) where.storeId = storeId;

    const [allPaidBills, stores, vendors] = await Promise.all([
      noStoreAssigned
        ? Promise.resolve([])
        : prisma.bill.findMany({
            where,
            select: {
              id: true,
              vendor: true,
              billNumber: true,
              subtotalCents: true,
              shippingCents: true,
              minOrderFeeCents: true,
              dropShipFeeCents: true,
              dueDate: true,
              paidAt: true,
              po: { select: { id: true, poNumber: true } },
              items: {
                select: { lineCostCents: true, product: { select: { excludeFromRebate: true } } },
              },
            },
          }),
      prisma.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.vendor.findMany({
        select: { name: true, rebateBps: true, strataBuyingGroup: true, hasOpenAccount: true },
      }),
    ]);

    const bills = allPaidBills.filter((b) => {
      const effective = b.dueDate ?? b.paidAt;
      return !!effective && effective >= from && effective <= to;
    });

    const rebateByVendor = new Map(vendors.map((v) => [v.name.trim().toLowerCase(), v.rebateBps]));
    const vendorByName = new Map(vendors.map((v) => [v.name.trim().toLowerCase(), v]));

    const byVendor = new Map<
      string,
      {
        billCount: number;
        paidCents: number;
        rebateEligibleCents: number;
        bills: {
          id: string;
          billNumber: string;
          poId: string | null;
          poNumber: string | null;
          dueDate: string | null;
          paidAt: string | null;
          amountCents: number;
          hasRebateAdjustment: boolean;
        }[];
      }
    >();
    for (const b of bills) {
      const vendor = b.vendor?.trim() || "Unassigned";
      const row = byVendor.get(vendor) ?? {
        billCount: 0,
        paidCents: 0,
        rebateEligibleCents: 0,
        bills: [],
      };
      // Items flagged "exclude from rebate" (Products), plus shipping,
      // minimum-order and drop-ship fees, all come straight out of this
      // bill's rebate basis.
      const excludedItemCents = b.items.reduce(
        (s, it) => s + (it.product?.excludeFromRebate ? it.lineCostCents : 0),
        0,
      );
      const excludedFeeCents = b.shippingCents + b.minOrderFeeCents + b.dropShipFeeCents;
      const rebateEligibleCents = Math.max(
        0,
        b.subtotalCents - excludedItemCents - excludedFeeCents,
      );
      row.billCount += 1;
      row.paidCents += b.subtotalCents;
      row.rebateEligibleCents += rebateEligibleCents;
      row.bills.push({
        id: b.id,
        billNumber: b.billNumber,
        poId: b.po?.id ?? null,
        poNumber: b.po?.poNumber ?? null,
        dueDate: b.dueDate?.toISOString() ?? null,
        paidAt: b.paidAt?.toISOString() ?? null,
        amountCents: b.subtotalCents,
        hasRebateAdjustment: excludedItemCents > 0 || excludedFeeCents > 0,
      });
      byVendor.set(vendor, row);
    }

    const rows = [...byVendor.entries()]
      .map(([vendor, v]) => {
        const rebateBps = rebateByVendor.get(vendor.trim().toLowerCase()) ?? 0;
        const vendorRow = vendorByName.get(vendor.trim().toLowerCase());
        return {
          vendor,
          billCount: v.billCount,
          paidCents: v.paidCents,
          bills: v.bills.sort((a, b) =>
            (a.dueDate ?? a.paidAt ?? "").localeCompare(b.dueDate ?? b.paidAt ?? ""),
          ),
          rebateBps,
          rebateCents: Math.round((v.rebateEligibleCents * rebateBps) / 10_000),
          strataBuyingGroup: vendorRow?.strataBuyingGroup ?? false,
          hasOpenAccount: vendorRow?.hasOpenAccount ?? false,
        };
      })
      .sort((a, b) => b.paidCents - a.paidCents);

    function sumRows(list: typeof rows) {
      return list.reduce(
        (t, r) => ({
          billCount: t.billCount + r.billCount,
          paidCents: t.paidCents + r.paidCents,
          rebateCents: t.rebateCents + r.rebateCents,
        }),
        { billCount: 0, paidCents: 0, rebateCents: 0 },
      );
    }

    const totals = sumRows(rows);
    // Split out the Strata buying-group vendors from everyone else, so the
    // two can be compared at a glance instead of hunting through one list.
    const strataRows = rows.filter((r) => r.strataBuyingGroup);
    const otherRows = rows.filter((r) => !r.strataBuyingGroup);

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
      strata: { rows: strataRows, totals: sumRows(strataRows) },
      other: { rows: otherRows, totals: sumRows(otherRows) },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
