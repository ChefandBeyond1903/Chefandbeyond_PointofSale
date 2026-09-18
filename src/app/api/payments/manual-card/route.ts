import { NextRequest } from "next/server";
import { requireUser, HttpError } from "@/lib/auth";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { ok, toErrorResponse } from "@/lib/api";

// Manually-keyed card entry at the register — a stopgap for stores without a
// paired Stripe Terminal reader yet. Creates an online (not card_present)
// PaymentIntent the register confirms client-side with Stripe Elements;
// verifyPaidIntent (lib/terminal.ts) checks it before the sale is written.
export async function POST(req: NextRequest) {
  try {
    await requireUser();
    if (!stripeConfigured()) throw new HttpError(400, "Card payments aren't set up (no Stripe key).");
    const body = (await req.json()) as { amountCents?: unknown };
    const amountCents = typeof body.amountCents === "number" ? Math.round(body.amountCents) : 0;
    if (!Number.isInteger(amountCents) || amountCents < 50) {
      throw new HttpError(400, "Card payments must be at least $0.50.");
    }
    const intent = await stripe().paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      payment_method_types: ["card"],
    });
    return ok({ clientSecret: intent.client_secret, paymentIntentId: intent.id }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
