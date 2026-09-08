import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedRole } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

// Remove a custom payment method. Past sales keep the method string they were
// recorded with — only the option to pick it again goes away.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Payment method not found");
    await prisma.paymentMethod.delete({ where: { id } });
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
