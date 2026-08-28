import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, HttpError } from "@/lib/auth";
import { vendorUpdateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireRole("MANAGER");
    const { id } = await params;
    const data = vendorUpdateSchema.parse(await req.json());

    // If the name changes, carry it across to the products that use it.
    if (data.name) {
      const existing = await prisma.vendor.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, "Vendor not found");
      if (existing.name !== data.name) {
        await prisma.product.updateMany({
          where: { vendor: existing.name },
          data: { vendor: data.name },
        });
      }
    }

    const vendor = await prisma.vendor.update({ where: { id }, data });
    return ok({ vendor });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireRole("MANAGER");
    const { id } = await params;
    // Removes the directory entry only; products keep their vendor name.
    await prisma.vendor.delete({ where: { id } });
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
