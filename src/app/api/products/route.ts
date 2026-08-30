import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireRole, HttpError } from "@/lib/auth";
import { productCreateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    await requireUser();
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

    const products = await prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      take,
      include: { category: { select: { id: true, name: true } } },
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
        stock: data.stock,
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
