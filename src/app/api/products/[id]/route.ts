import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireRole, HttpError } from "@/lib/auth";
import { productUpdateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireUser();
    const { id } = await params;
    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: { select: { id: true, name: true } } },
    });
    if (!product) throw new HttpError(404, "Product not found");
    return ok({ product });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireRole("MANAGER");
    const { id } = await params;
    const data = productUpdateSchema.parse(await req.json());

    // Enforce: sticker price may never sit below the UMRP. Fall back to the
    // stored values for whichever of the two isn't part of this update.
    if (data.priceCents !== undefined || data.umrpCents !== undefined) {
      const existing = await prisma.product.findUnique({
        where: { id },
        select: { priceCents: true, umrpCents: true },
      });
      if (!existing) throw new HttpError(404, "Product not found");
      const price = data.priceCents ?? existing.priceCents;
      const umrp = data.umrpCents ?? existing.umrpCents;
      if (umrp > 0 && price < umrp) {
        throw new HttpError(400, "Price can't be below the minimum resale price (UMRP)");
      }
    }

    const product = await prisma.product.update({
      where: { id },
      data,
      include: { category: { select: { id: true, name: true } } },
    });
    return ok({ product });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Soft delete: keeps sale history intact.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireRole("MANAGER");
    const { id } = await params;
    const product = await prisma.product.update({
      where: { id },
      data: { active: false },
    });
    return ok({ product });
  } catch (err) {
    return toErrorResponse(err);
  }
}
