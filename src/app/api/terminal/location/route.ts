import { HttpError } from "@/lib/auth";
import { requireScopedUser } from "@/lib/scope";
import { ensureLocation } from "@/lib/terminal";
import { ok, toErrorResponse } from "@/lib/api";

// The Stripe Terminal Location an SDK-driven reader (Tap to Pay) connects
// under — tied to the caller's store, created on first use. An admin with no
// assigned store has no single answer here; they pick a store elsewhere.
export async function GET() {
  try {
    const u = await requireScopedUser();
    if (!u.storeId) throw new HttpError(400, "You're not assigned to a store yet.");
    const locationId = await ensureLocation(u.storeId);
    return ok({ locationId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
