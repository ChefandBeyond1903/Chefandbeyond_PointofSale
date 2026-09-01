import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole, HttpError } from "@/lib/auth";
import { requireScopedUser } from "@/lib/scope";
import {
  productBulkDeleteSchema,
  productBulkUpdateSchema,
  productCreateSchema,
} from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();
    const categoryId = searchParams.get("categoryId")?.trim();
    const includeInactive = searchParams.get("all") === "1";
    const favoritesOnly = searchParams.get("favorite") === "1";
    const take = Math.min(Number(searchParams.get("take") ?? 200), 5000);

    const where: Prisma.ProductWhereInput = {};
    if (!includeInactive) where.active = true;
    if (favoritesOnly) where.favorite = true;
    if (categoryId) where.categoryId = categoryId;
    if (q) {
      // Order-independent: every whitespace-separated term must appear somewhere
      // in the name, description, SKU, or barcode (case-insensitive). So
      // "deep 40 fryer" and "fryer 40 deep" both match "40 lbs Deep Fryer".
      where.AND = q.split(/\s+/).filter(Boolean).map((term) => ({
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { description: { contains: term, mode: "insensitive" } },
          { sku: { contains: term, mode: "insensitive" } },
          { barcode: { contains: term, mode: "insensitive" } },
        ],
      }));
    }

    // One round trip: pull each product with its per-store inventory rows, then
    // reduce to the on-hand figure for the caller's store (total for an admin).
    const rows = await prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      take,
      include: {
        category: { select: { id: true, name: true } },
        inventory: { select: { storeId: true, quantity: true } },
      },
    });

    const products = rows.map(({ inventory, ...p }) => {
      const stock = inventory.reduce(
        (sum, i) => (actor.storeId ? (i.storeId === actor.storeId ? sum + i.quantity : sum) : sum + i.quantity),
        0,
      );
      return { ...p, stock };
    });
    return ok({ products });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const data = productCreateSchema.parse(await req.json());
    if (data.umrpCents > 0 && data.priceCents < data.umrpCents) {
      throw new HttpError(400, "Price can't be below the minimum resale price (UMRP)");
    }
    const product = await prisma.product.create({
      data: {
        name: data.name,
        sku: data.sku,
        barcode: data.barcode,
        description: data.description,
        priceCents: data.priceCents,
        costCents: data.costCents,
        umrpCents: data.umrpCents,
        trackStock: data.trackStock,
        active: data.active,
        favorite: data.favorite,
        vendor: data.vendor,
        categoryId: data.categoryId,
      },
      include: { category: { select: { id: true, name: true } } },
    });
    return ok({ product }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Bulk edit from the Products page: move/clear category (and/or set active) on
// many products at once. Per-product PATCH lives at /api/products/[id].
export async function PATCH(req: NextRequest) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const { ids, categoryId, active } = productBulkUpdateSchema.parse(await req.json());

    const data: Prisma.ProductUncheckedUpdateManyInput = {};
    if (categoryId !== undefined) {
      if (categoryId !== null) {
        const cat = await prisma.category.findUnique({
          where: { id: categoryId },
          select: { id: true },
        });
        if (!cat) throw new HttpError(400, "Category not found");
      }
      data.categoryId = categoryId;
    }
    if (active !== undefined) data.active = active;

    const { count } = await prisma.product.updateMany({
      where: { id: { in: ids } },
      data,
    });
    return ok({ count });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Bulk delete. Default (hard:false) archives — active:false, keeping sale
// history, same as the single-product DELETE. hard:true permanently removes
// every selected product that no sale line references; any that ARE referenced
// are archived instead so invoices stay intact. Returns how many of each.
export async function DELETE(req: NextRequest) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const { ids, hard } = productBulkDeleteSchema.parse(await req.json());

    if (!hard) {
      const { count } = await prisma.product.updateMany({
        where: { id: { in: ids } },
        data: { active: false },
      });
      return ok({ archived: count, deleted: 0 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const referenced = new Set(
        (
          await tx.saleItem.findMany({
            where: { productId: { in: ids } },
            select: { productId: true },
            distinct: ["productId"],
          })
        ).map((r) => r.productId),
      );
      const removable = ids.filter((id) => !referenced.has(id));

      if (removable.length) {
        // Detach optional references, then let StoreInventory cascade on delete.
        await tx.purchaseOrderItem.updateMany({
          where: { productId: { in: removable } },
          data: { productId: null },
        });
        await tx.billItem.updateMany({
          where: { productId: { in: removable } },
          data: { productId: null },
        });
        await tx.product.deleteMany({ where: { id: { in: removable } } });
      }
      if (referenced.size) {
        await tx.product.updateMany({
          where: { id: { in: [...referenced] } },
          data: { active: false },
        });
      }
      return { deleted: removable.length, archived: referenced.size };
    });

    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
