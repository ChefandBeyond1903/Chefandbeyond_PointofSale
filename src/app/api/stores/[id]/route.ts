import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, HttpError } from "@/lib/auth";
import { requireScopedUser } from "@/lib/scope";
import { storeUpdateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const data = storeUpdateSchema.parse(await req.json());

    if (actor.role !== "ADMIN") {
      // A manager may only touch their own store's contact details.
      if (actor.role !== "MANAGER" || actor.storeId !== id) {
        throw new HttpError(403, "You can only edit your own store");
      }
      for (const k of ["name", "taxRateBps", "active"] as const) {
        if (data[k] !== undefined) {
          throw new HttpError(403, `Only an admin can change a store's ${k}`);
        }
      }
    }

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
    await requireRole("ADMIN");
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
