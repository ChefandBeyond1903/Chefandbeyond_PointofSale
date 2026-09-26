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
            select: { vendor: true, subtotalCents: true, dueDate: true, paidAt: true },
          }),
      prisma.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.vendor.findMany({ select: { name: true, rebateBps: true } }),
    ]);

    const bills = allPaidBills.filter((b) => {
      const effective = b.dueDate ?? b.paidAt;
      return !!effective && effective >= from && effective <= to;
    });

    const rebateByVendor = new Map(vendors.map((v) => [v.name.trim().toLowerCase(), v.rebateBps]));

    const byVendor = new Map<string, { billCount: number; paidCents: number }>();
    for (const b of bills) {
      const vendor = b.vendor?.trim() || "Unassigned";
      const row = byVendor.get(vendor) ?? { billCount: 0, paidCents: 0 };
      row.billCount += 1;
      row.paidCents += b.subtotalCents;
      byVendor.set(vendor, row);
    }

    const rows = [...byVendor.entries()]
      .map(([vendor, v]) => {
        const rebateBps = rebateByVendor.get(vendor.trim().toLowerCase()) ?? 0;
        return {
          vendor,
          billCount: v.billCount,
          paidCents: v.paidCents,
          rebateBps,
          rebateCents: Math.round((v.paidCents * rebateBps) / 10_000),
        };
      })
      .sort((a, b) => b.paidCents - a.paidCents);

    const totals = rows.reduce(
      (t, r) => ({
        billCount: t.billCount + r.billCount,
        paidCents: t.paidCents + r.paidCents,
        rebateCents: t.rebateCents + r.rebateCents,
      }),
      { billCount: 0, paidCents: 0, rebateCents: 0 },
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
