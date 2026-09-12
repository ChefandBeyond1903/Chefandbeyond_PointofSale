import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

// Mark a transfer shipped — the fulfilling store confirming the item actually
// went out. Anyone at that store (any role) can do it, same as anyone there
// can ring the sale that creates one; an admin can act on any store's.
export async function PATCH(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const transfer = await prisma.transfer.findUnique({ where: { id } });
    if (!transfer) throw new HttpError(404, "Transfer not found");
    if (actor.role !== "ADMIN" && transfer.fromStoreId !== actor.storeId) {
      throw new HttpError(403, "Only the fulfilling store can mark this shipped");
    }
    if (transfer.status === "SHIPPED") return ok({ transfer });

    const updated = await prisma.transfer.update({
      where: { id },
      data: { status: "SHIPPED", shippedAt: new Date() },
    });
    return ok({ transfer: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
