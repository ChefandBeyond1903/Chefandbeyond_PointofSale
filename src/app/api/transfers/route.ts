import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireScopedUser, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

// Cross-store fulfillments — a sale rung at one store that drew stock from
// another. A non-admin sees transfers touching their own store on either
// side (they raised the sale, or they need to ship it); an admin sees every
// store, optionally narrowed with ?storeId=.
export async function GET(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status")?.trim();
    const storeParam = searchParams.get("storeId")?.trim();
    // For the nav badge: only transfers this store itself needs to ship,
    // not ones it merely sold into from elsewhere.
    const mineOnly = searchParams.get("mine") === "1";

    const scoped = scopeStoreId(actor);
    const where: Prisma.TransferWhereInput = {};
    if (status === "PENDING" || status === "SHIPPED") where.status = status;
    if (scoped && mineOnly) {
      where.fromStoreId = scoped;
    } else if (scoped) {
      where.OR = [{ fromStoreId: scoped }, { toStoreId: scoped }];
    } else if (storeParam) {
      where.OR = [{ fromStoreId: storeParam }, { toStoreId: storeParam }];
    }

    const [transfers, stores] = await Promise.all([
      prisma.transfer.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 }),
      prisma.store.findMany({ select: { id: true, name: true } }),
    ]);
    const storeNameById = new Map(stores.map((s) => [s.id, s.name]));

    return ok({
      transfers: transfers.map((t) => ({
        ...t,
        fromStoreName: storeNameById.get(t.fromStoreId) ?? "",
        toStoreName: storeNameById.get(t.toStoreId) ?? "",
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
