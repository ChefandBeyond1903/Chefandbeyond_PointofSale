import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, HttpError } from "@/lib/auth";
import { categoryUpdateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const { id } = await params;
    const { name } = categoryUpdateSchema.parse(await req.json());
    const category = await prisma.category.update({
      where: { id },
      data: { name },
      include: { _count: { select: { products: true } } },
    });
    return ok({ category });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Products keep their name/price/etc.; the category relation just clears
// (Product.categoryId -> null) since it's an optional, SetNull relation.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const { id } = await params;
    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) throw new HttpError(404, "Category not found");
    await prisma.category.delete({ where: { id } });
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
