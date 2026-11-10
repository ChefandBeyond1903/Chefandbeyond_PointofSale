import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { earlyPayDiscountCents } from "@/lib/billFees";
import { ok, toErrorResponse } from "@/lib/api";
import { effectiveGroup, rebateBpsFor, type BuyingGroup } from "@/lib/buyingGroup";

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
              earlyPayDiscountBps: true,
              dueDate: true,
              paidAt: true,
              po: { select: { id: true, poNumber: true } },
              items: {
                select: {
                  lineCostCents: true,
                  product: { select: { excludeFromRebate: true, buyingGroup: true } },
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
          hasOpenAccount: true,
        },
      }),
    ]);

    const bills = allPaidBills.filter((b) => {
      const effective = b.dueDate ?? b.paidAt;
      return !!effective && effective >= from && effective <= to;
    });

    const vendorByName = new Map(vendors.map((v) => [v.name.trim().toLowerCase(), v]));

    // One row per vendor PER buying group — a vendor bought from through both
    // Strata and USA-FED shows up in each section with just that group's share.
    type Group = BuyingGroup | "";
    const byVendor = new Map<
      string,
      {
        vendor: string;
        group: Group;
        billCount: number;
        paidCents: number;
        rebateEligibleCents: number;
        discountCents: number;
        bills: {
          id: string;
          billNumber: string;
          poId: string | null;
          poNumber: string | null;
          dueDate: string | null;
          paidAt: string | null;
          amountCents: number;
          hasRebateAdjustment: boolean;
          discountCents: number;
        }[];
      }
    >();
    for (const b of bills) {
      const vendor = b.vendor?.trim() || "Unassigned";
      const vendorRow = vendorByName.get(vendor.toLowerCase());
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
      const itemsCents = b.items.reduce((s, it) => s + it.lineCostCents, 0);
      const discountCents = earlyPayDiscountCents(itemsCents, b.earlyPayDiscountBps);

      // Split the bill across buying groups by each group's share of its items.
      const parts = new Map<Group, { items: number; eligibleItems: number }>();
      for (const it of b.items) {
        const g = effectiveGroup(it.product?.buyingGroup, vendorRow);
        const part = parts.get(g) ?? { items: 0, eligibleItems: 0 };
        part.items += it.lineCostCents;
        if (!it.product?.excludeFromRebate) part.eligibleItems += it.lineCostCents;
        parts.set(g, part);
      }
      if (parts.size === 0) parts.set(effectiveGroup("", vendorRow), { items: 0, eligibleItems: 0 });
      const eligibleItemsTotal = [...parts.values()].reduce((t, x) => t + x.eligibleItems, 0);

      const entries = [...parts.entries()];
      let paidLeft = b.subtotalCents;
      let eligLeft = rebateEligibleCents;
      let discLeft = discountCents;
      entries.forEach(([group, part], i) => {
        const last = i === entries.length - 1;
        const itemShare = itemsCents > 0 ? part.items / itemsCents : 1;
        const eligShare = eligibleItemsTotal > 0 ? part.eligibleItems / eligibleItemsTotal : itemShare;
        const paid = last ? paidLeft : Math.round(b.subtotalCents * itemShare);
        const elig = last ? eligLeft : Math.round(rebateEligibleCents * eligShare);
        const disc = last ? discLeft : Math.round(discountCents * itemShare);
        paidLeft -= paid;
        eligLeft -= elig;
        discLeft -= disc;

        const key = `${vendor}|${group}`;
        const row = byVendor.get(key) ?? {
          vendor,
          group,
          billCount: 0,
          paidCents: 0,
          rebateEligibleCents: 0,
          discountCents: 0,
          bills: [],
        };
        row.billCount += 1;
        row.paidCents += paid;
        row.rebateEligibleCents += elig;
        row.discountCents += disc;
        row.bills.push({
          id: b.id,
          billNumber: b.billNumber,
          poId: b.po?.id ?? null,
          poNumber: b.po?.poNumber ?? null,
          dueDate: b.dueDate?.toISOString() ?? null,
          paidAt: b.paidAt?.toISOString() ?? null,
          amountCents: paid,
          hasRebateAdjustment: excludedItemCents > 0 || excludedFeeCents > 0,
          discountCents: disc,
        });
        byVendor.set(key, row);
      });
    }

    const rows = [...byVendor.values()]
      .map((v) => {
        const vendorRow = vendorByName.get(v.vendor.trim().toLowerCase());
        const rebateBps = rebateBpsFor(v.group, vendorRow);
        return {
          vendor: v.vendor,
          group: v.group,
          billCount: v.billCount,
          paidCents: v.paidCents,
          bills: v.bills.sort((a, b) =>
            (a.dueDate ?? a.paidAt ?? "").localeCompare(b.dueDate ?? b.paidAt ?? ""),
          ),
          rebateBps,
          rebateCents: Math.round((v.rebateEligibleCents * rebateBps) / 10_000),
          discountCents: v.discountCents,
          strataBuyingGroup: vendorRow?.strataBuyingGroup ?? false,
          usaFedBuyingGroup: vendorRow?.usaFedBuyingGroup ?? false,
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
          discountCents: t.discountCents + r.discountCents,
        }),
        { billCount: 0, paidCents: 0, rebateCents: 0, discountCents: 0 },
      );
    }

    const totals = sumRows(rows);
    // Split by buying group — Strata, USA-FED, and everyone else — so each
    // rebate can be tracked on its own.
    const strataRows = rows.filter((r) => r.group === "STRATA");
    const usaFedRows = rows.filter((r) => r.group === "USAFED");
    const otherRows = rows.filter((r) => r.group === "");

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
      usaFed: { rows: usaFedRows, totals: sumRows(usaFedRows) },
      other: { rows: otherRows, totals: sumRows(otherRows) },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
