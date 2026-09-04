import { getCurrentUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/api";

export async function GET() {
  const session = await getCurrentUser();
  if (!session) {
    // A live Supabase session that no longer resolves to a POS user means the
    // account was deactivated or signed in elsewhere — 401 so the client
    // bounces to /login instead of quietly showing a logged-out UI.
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) return ok({ error: "Signed out" }, 401);
    return ok({ user: null });
  }

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
