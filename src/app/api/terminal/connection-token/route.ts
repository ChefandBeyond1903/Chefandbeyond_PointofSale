import { HttpError } from "@/lib/auth";
import { requireScopedUser } from "@/lib/scope";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { ok, toErrorResponse } from "@/lib/api";

// Stripe Terminal SDK-driven flow (Tap to Pay, or any client-connected
// reader): the app calls this to get a ConnectionToken it uses to talk to
// Stripe directly. Only ever proves who's asking — it grants no access to
// our own data, so any signed-in staff member can request one.
export async function POST() {
  try {
    await requireScopedUser();
    if (!stripeConfigured()) throw new HttpError(400, "Card payments aren't set up (no Stripe key).");
    const token = await stripe().terminal.connectionTokens.create();
    return ok({ secret: token.secret });
  } catch (err) {
    return toErrorResponse(err);
  }
}
