import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireScopedUser, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";

// Active staff the caller may credit a sale to: everyone in their store
// (an admin sees every active user).
export async function GET() {
  try {
    const actor = await requireScopedUser();
    const where: Prisma.UserWhereInput = { active: true };
    const scoped = scopeStoreId(actor);
    // Everyone in the caller's store, plus the admins — an admin can be
    // credited (after entering their password at the register) at any store.
    if (scoped) where.OR = [{ storeId: scoped }, { role: "ADMIN" }];

    const people = await prisma.user.findMany({
      where,
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    });
    return ok({ people });
  } catch (err) {
    return toErrorResponse(err);
  }
}
