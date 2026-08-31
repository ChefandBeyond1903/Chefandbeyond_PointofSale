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
      where.OR = [
        { name: { contains: q } },
        { sku: { contains: q } },
        { barcode: { contains: q } },
      ];
    }

    const rows = await prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      take,
      include: { category: { select: { id: true, name: true } } },
    });

    // Attach on-hand for the caller's store (total across stores for an admin).
    const inv = await prisma.storeInventory.findMany({
      where: { productId: { in: rows.map((p) => p.id) } },
      select: { productId: true, storeId: true, quantity: true },
    });
    const byProduct = new Map<string, { total: number; forStore: number }>();
    for (const i of inv) {
      const e = byProduct.get(i.productId) ?? { total: 0, forStore: 0 };
      e.total += i.quantity;
      if (actor.storeId && i.storeId === actor.storeId) e.forStore += i.quantity;
      byProduct.set(i.productId, e);
    }
    const products = rows.map((p) => {
      const e = byProduct.get(p.id);
      return { ...p, stock: actor.storeId ? (e?.forStore ?? 0) : (e?.total ?? 0) };
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

// Bulk soft-delete (archive): hides the products from the register but keeps
// sale history intact, matching the single-product DELETE.
export async function DELETE(req: NextRequest) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const { ids } = productBulkDeleteSchema.parse(await req.json());
    const { count } = await prisma.product.updateMany({
      where: { id: { in: ids } },
      data: { active: false },
    });
    return ok({ count });
  } catch (err) {
    return toErrorResponse(err);
  }
}
