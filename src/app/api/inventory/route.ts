import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser } from "@/lib/scope";
import { inventoryAdjustSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";
import { searchTerms } from "@/lib/search";

// Every store's on-hand quantities, visible to all staff.
export async function GET(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();
    const includeInactive = searchParams.get("all") === "1";

    const where: Prisma.ProductWhereInput = {};
    if (!includeInactive) where.active = true;
    if (q) {
      // Order- and format-independent: every term must appear somewhere in the
      // name, description, SKU, barcode, or vendor (case-insensitive), any order.
      const terms = searchTerms(q);
      if (terms.length) {
        where.AND = terms.map((term) => ({
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { description: { contains: term, mode: "insensitive" } },
            { sku: { contains: term, mode: "insensitive" } },
            { barcode: { contains: term, mode: "insensitive" } },
            { vendor: { contains: term, mode: "insensitive" } },
          ],
        }));
      }
    }

    const [stores, products] = await Promise.all([
      prisma.store.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, active: true },
      }),
      prisma.product.findMany({
        where,
        orderBy: { name: "asc" },
        select: { id: true, name: true, sku: true, vendor: true, trackStock: true, active: true },
      }),
    ]);

    const inv = await prisma.storeInventory.findMany({
      where: { productId: { in: products.map((p) => p.id) } },
      select: { productId: true, storeId: true, quantity: true },
    });
    const byProduct = new Map<string, Record<string, number>>();
    for (const i of inv) {
      const e = byProduct.get(i.productId) ?? {};
      e[i.storeId] = i.quantity;
      byProduct.set(i.productId, e);
    }

    const rows = products.map(({ id, ...rest }) => {
      const byStore = byProduct.get(id) ?? {};
      const total = Object.values(byStore).reduce((a, b) => a + b, 0);
      return { productId: id, ...rest, byStore, total };
    });

    return ok({
      stores,
      rows,
      editableStoreId: actor.role === "ADMIN" ? null : (actor.storeId ?? null),
      canAdjust: actor.role !== "CASHIER" && (actor.role === "ADMIN" || !!actor.storeId),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Set the on-hand quantity of one product at one store (opening counts,
// stock takes, corrections). Managers: own store only. Admin: any store.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    if (actor.role === "CASHIER") {
      throw new HttpError(403, "Only managers can adjust inventory directly");
    }
    const { productId, storeId, quantity } = inventoryAdjustSchema.parse(await req.json());
    if (actor.role !== "ADMIN" && storeId !== actor.storeId) {
      throw new HttpError(403, "You can only adjust your own store's inventory");
    }
    const inventory = await prisma.storeInventory.upsert({
      where: { productId_storeId: { productId, storeId } },
      create: { productId, storeId, quantity },
      update: { quantity },
    });
    return ok({ inventory });
  } catch (err) {
    return toErrorResponse(err);
  }
}
