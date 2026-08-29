import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, HttpError } from "@/lib/auth";
import { storeUpdateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireRole("MANAGER");
    const { id } = await params;
    const data = storeUpdateSchema.parse(await req.json());
    const store = await prisma.store.update({
      where: { id },
      data,
      include: { _count: { select: { users: true, sales: true } } },
    });
    return ok({ store });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Only removable while nothing references it; otherwise deactivate instead.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireRole("MANAGER");
    const { id } = await params;
    const counts = await prisma.store.findUnique({
      where: { id },
      select: { _count: { select: { users: true, sales: true } } },
    });
    if (!counts) throw new HttpError(404, "Store not found");
    if (counts._count.users > 0 || counts._count.sales > 0) {
      throw new HttpError(
        400,
        "This store has staff or sales on it. Deactivate it instead of deleting.",
      );
    }
    await prisma.store.delete({ where: { id } });
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
