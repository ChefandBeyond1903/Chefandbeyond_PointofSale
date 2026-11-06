import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// A "Pay now" link in an invoice email: /api/pay/<saleId>?t=<signature>. The
// signature proves the link was issued by us, so a saleId can't be guessed
// into a payment page. The link itself never expires — each click opens a
// fresh Stripe Checkout for whatever is still owed.

function secret(): string {
  const s = process.env.INVOICE_LINK_SECRET || process.env.STRIPE_SECRET_KEY;
  if (!s) throw new Error("No secret available to sign pay links");
  return s;
}

function sign(saleId: string): string {
  return createHmac("sha256", secret()).update(`pay:${saleId}`).digest("hex").slice(0, 32);
}

export function payLinkFor(origin: string, saleId: string): string {
  return `${origin}/api/pay/${saleId}?t=${sign(saleId)}`;
}

export function verifyPayToken(saleId: string, token: string | null): boolean {
  if (!token) return false;
  const a = Buffer.from(sign(saleId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
