import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedRole, assertCustomerInScope } from "@/lib/scope";
import { customerLocationUpdateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string; locId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id, locId } = await params;
    await assertCustomerInScope(id, actor);
    const loc = await prisma.customerLocation.findUnique({ where: { id: locId } });
    if (!loc || loc.customerId !== id) throw new HttpError(404, "Location not found");
    const f = customerLocationUpdateSchema.parse(await req.json());
    const location = await prisma.customerLocation.update({ where: { id: locId }, data: f });
    return ok({ location });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id, locId } = await params;
    await assertCustomerInScope(id, actor);
    const loc = await prisma.customerLocation.findUnique({ where: { id: locId } });
    if (!loc || loc.customerId !== id) throw new HttpError(404, "Location not found");
    await prisma.customerLocation.delete({ where: { id: locId } });
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
