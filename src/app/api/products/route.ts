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
import { searchTerms } from "@/lib/search";
import { ensureVendor } from "@/lib/vendors";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();
    const categoryId = searchParams.get("categoryId")?.trim();
    const includeInactive = searchParams.get("all") === "1";
    const favoritesOnly = searchParams.get("favorite") === "1";
    // The register grid never shows description/timestamps; skipping them keeps
    // a full-catalog load small. The Products admin page asks for detail=1.
    const withDetail = searchParams.get("detail") === "1";
    const take = Math.min(Number(searchParams.get("take") ?? 200), 5000);

    const where: Prisma.ProductWhereInput = {};
    if (!includeInactive) where.active = true;
    if (favoritesOnly) where.favorite = true;
    if (categoryId) where.categoryId = categoryId;
    if (q) {
      // Order- and format-independent: every term must appear somewhere in the
      // name, description, SKU, or barcode (case-insensitive), in any order.
      const terms = searchTerms(q);
      if (terms.length) {
        where.AND = terms.map((term) => ({
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { description: { contains: term, mode: "insensitive" } },
            { sku: { contains: term, mode: "insensitive" } },
            { barcode: { contains: term, mode: "insensitive" } },
          ],
        }));
      }
    }

    // Skip description + timestamps unless detail=1: a description can be ~1KB
    // and there can be thousands of products, so the register load stays lean.
    const rows = await prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      take,
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        priceCents: true,
        costCents: true,
        umrpCents: true,
        trackStock: true,
        active: true,
        favorite: true,
        vendor: true,
        categoryId: true,
        category: { select: { id: true, name: true } },
        description: withDetail,
        createdAt: withDetail,
        updatedAt: withDetail,
      },
    });

    // On-hand in one grouped query — the caller's store, or every store for an
    // admin — instead of dragging back every StoreInventory row per product.
    const stockByProduct = new Map<string, number>();
    if (rows.length) {
      const grouped = await prisma.storeInventory.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        where: {
          productId: { in: rows.map((r) => r.id) },
          ...(actor.storeId ? { storeId: actor.storeId } : {}),
        },
      });
      for (const g of grouped) stockByProduct.set(g.productId, g._sum.quantity ?? 0);
    }

    const products = rows.map((p) => ({ ...p, stock: stockByProduct.get(p.id) ?? 0 }));
    return ok({ products });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("MANAGER", "ADMIN");
    const data = productCreateSchema.parse(await req.json());
    // Only an admin may set a resale floor.
    if (actor.role !== "ADMIN") data.umrpCents = 0;
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
    await ensureVendor(product.vendor);
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
