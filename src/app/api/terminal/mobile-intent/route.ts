import { NextRequest } from "next/server";
import { HttpError } from "@/lib/auth";
import { requireScopedUser } from "@/lib/scope";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { ok, toErrorResponse } from "@/lib/api";

// Tap to Pay (and any other SDK-driven reader) collects the card on the
// device itself, not by our server pushing to a registered reader — so the
// app needs its own PaymentIntent up front, not startCharge()'s
// processPaymentIntent call. Once the SDK confirms it, the mobile app submits
// the sale the same way the register and invoices do, and verifyPaidIntent
// checks it before anything is written.
export async function POST(req: NextRequest) {
  try {
    await requireScopedUser();
    if (!stripeConfigured()) throw new HttpError(400, "Card payments aren't set up (no Stripe key).");
    const body = (await req.json()) as { amountCents?: unknown };
    const amountCents = typeof body.amountCents === "number" ? Math.round(body.amountCents) : 0;
    if (!Number.isInteger(amountCents) || amountCents < 50) {
      throw new HttpError(400, "Card payments must be at least $0.50.");
    }
    const intent = await stripe().paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      payment_method_types: ["card_present"],
      capture_method: "automatic",
    });
    return ok({ clientSecret: intent.client_secret, paymentIntentId: intent.id }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
