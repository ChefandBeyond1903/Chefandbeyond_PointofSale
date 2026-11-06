import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { stripe, stripeConfigured } from "@/lib/stripe";

// Stripe → POS. When a customer pays an invoice through its email "Pay now"
// button (Checkout), record that payment against the invoice. Only handles
// sessions we created (metadata.kind === "invoice-pay"); everything else the
// shared Stripe account sends (e.g. the web store) is ignored.
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  if (!stripeConfigured() || !secret || !sig) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), sig, secret);
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return NextResponse.json({ received: true });
  }
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.kind !== "invoice-pay" || session.payment_status !== "paid") {
    return NextResponse.json({ received: true });
  }
  const saleId = session.metadata.saleId;
  const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const amountCents = session.amount_total ?? 0;
  if (!saleId || !intentId || amountCents < 1) return NextResponse.json({ received: true });

  // Already recorded (Stripe retries) — nothing to do.
  const dup = await prisma.salePayment.findUnique({
    where: { stripePaymentIntentId: intentId },
    select: { id: true },
  });
  if (dup) return NextResponse.json({ received: true });

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: { id: true, status: true, totalCents: true, amountPaidCents: true, cashierId: true },
  });
  if (!sale) return NextResponse.json({ received: true });

  let cardBrand = "";
  let cardLast4 = "";
  try {
    const intent = await stripe().paymentIntents.retrieve(intentId, { expand: ["latest_charge"] });
    const charge = intent.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    const card = charge?.payment_method_details?.card;
    cardBrand = card?.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : "";
    cardLast4 = card?.last4 ?? "";
  } catch {
    /* card details are cosmetic — record the payment regardless */
  }

  const paidAt = new Date();
  const newPaid = sale.amountPaidCents + amountCents;
  const settled = newPaid >= sale.totalCents;
  const overpaid = sale.status !== "INVOICED" || newPaid > sale.totalCents;

  await prisma.$transaction(async (tx) => {
    await tx.salePayment.create({
      data: {
        saleId: sale.id,
        amountCents,
        method: "CARD",
        paidAt,
        isDeposit: !settled,
        createdById: sale.cashierId,
        stripePaymentIntentId: intentId,
        cardBrand,
        cardLast4,
        note: overpaid
          ? "Paid online via email Pay now link — NOTE: exceeded the balance owed, review/refund the difference"
          : "Paid online via email Pay now link",
      },
    });
    await tx.sale.update({
      where: { id: sale.id },
      data: {
        amountPaidCents: newPaid,
        ...(settled && sale.status === "INVOICED"
          ? {
              status: "COMPLETED",
              paidAt,
              paymentMethod: "CARD",
              checkNumber: "",
              tenderedCents: amountCents,
              changeCents: 0,
            }
          : {}),
      },
    });
  });
  return NextResponse.json({ received: true });
}
