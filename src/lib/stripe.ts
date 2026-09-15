import "server-only";
import Stripe from "stripe";

// Stripe, server-side only. STRIPE_SECRET_KEY is the same Chef and Beyond
// account the web store charges through (sandbox key while building, the
// live key at go-live). Unset = card readers are simply unavailable and the
// register keeps its "run the card on your own terminal" fallback.
let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** True on a sandbox/test key — enables the simulated-reader helpers. */
export function stripeTestMode(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
}

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!client) client = new Stripe(key);
  return client;
}
