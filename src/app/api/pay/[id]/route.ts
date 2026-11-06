import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { verifyPayToken } from "@/lib/payLink";

type Params = { params: Promise<{ id: string }> };

// Public (no login): the customer's "Pay now" button from an invoice email.
// Verifies the signed link, then sends them to a fresh Stripe Checkout for the
// invoice's current balance. The payment is recorded by the Stripe webhook.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const origin = req.nextUrl.origin;
  const back = (status: string) => NextResponse.redirect(`${origin}/pay/thanks?s=${status}`, 303);

  if (!stripeConfigured() || !verifyPayToken(id, req.nextUrl.searchParams.get("t"))) {
    return back("invalid");
  }
  const sale = await prisma.sale.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      websiteOrderNumber: true,
      status: true,
      totalCents: true,
      amountPaidCents: true,
      customerEmailSnapshot: true,
    },
  });
  if (!sale) return back("invalid");
  const balance = sale.totalCents - sale.amountPaidCents;
  if (sale.status !== "INVOICED" || balance < 1) return back("paid");

  const label = sale.websiteOrderNumber || `#${sale.number}`;
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: balance,
            product_data: { name: `Invoice ${label} — balance due` },
          },
        },
      ],
      ...(sale.customerEmailSnapshot ? { customer_email: sale.customerEmailSnapshot } : {}),
      metadata: { saleId: sale.id, kind: "invoice-pay" },
      payment_intent_data: { metadata: { saleId: sale.id, kind: "invoice-pay" } },
      success_url: `${origin}/pay/thanks?s=success`,
      cancel_url: `${origin}/pay/thanks?s=cancelled`,
    });
    if (!session.url) return back("error");
    return NextResponse.redirect(session.url, 303);
  } catch {
    return back("error");
  }
}
