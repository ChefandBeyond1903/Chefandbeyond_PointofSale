import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/api";

export async function GET() {
  const session = await getCurrentUser();
  if (!session) return ok({ user: null });

  // Enrich with the current store assignment (and its tax rate) from the DB so
  // the register can price sales without a re-login after an admin change.
  const row = await prisma.user.findUnique({
    where: { id: session.id },
    select: { store: { select: { id: true, name: true, taxRateBps: true } } },
  });

  return ok({
    user: {
      ...session,
      storeId: row?.store?.id ?? null,
      storeName: row?.store?.name ?? null,
      storeTaxRateBps: row?.store?.taxRateBps ?? null,
    },
  });
}
