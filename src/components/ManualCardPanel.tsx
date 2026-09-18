"use client";
import { useEffect, useState } from "react";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import type { CardPaid } from "@/components/CardReaderPanel";

let stripePromise: Promise<StripeJs | null> | null = null;
function getStripe(): Promise<StripeJs | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return stripePromise;
}

/** True when a publishable key is baked into this build — gates whether the panel can render at all. */
export function manualCardAvailable(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
}

function ManualCardInner({
  amountCents,
  beforeCharge,
  onPaid,
  paid,
}: {
  amountCents: number;
  beforeCharge?: () => Promise<void>;
  onPaid: (p: CardPaid) => void;
  paid: CardPaid | null;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<{ clientSecret: string }>("/api/payments/manual-card", {
      method: "POST",
      body: JSON.stringify({ amountCents }),
    })
      .then((res) => {
        if (!cancelled) setClientSecret(res.clientSecret);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Could not start the card payment.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [amountCents]);

  async function charge() {
    if (!stripe || !elements || !clientSecret) return;
    const card = elements.getElement(CardElement);
    if (!card) return;
    setBusy(true);
    setError(null);
    try {
      if (beforeCharge) await beforeCharge();
      const result = await stripe.confirmCardPayment(clientSecret, { payment_method: { card } });
      if (result.error) {
        setError(result.error.message ?? "The card was declined.");
        return;
      }
      if (result.paymentIntent?.status !== "succeeded") {
        setError("The payment wasn't completed.");
        return;
      }
      onPaid({ paymentIntentId: result.paymentIntent.id, cardBrand: "", cardLast4: "" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not complete the card payment.");
    } finally {
      setBusy(false);
    }
  }

  if (paid) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
        <p className="font-semibold">Card approved — {formatMoney(amountCents)}</p>
      </div>
    );
  }

  if (loading) return <p className="text-xs text-zinc-500">Loading card entry…</p>;
  if (!clientSecret) {
    return <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error ?? "Card entry unavailable."}</p>;
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-zinc-300 px-3 py-2.5">
        <CardElement options={{ style: { base: { fontSize: "15px" } } }} />
      </div>
      <button
        type="button"
        onClick={charge}
        disabled={busy || amountCents < 50}
        className="btn-primary w-full"
      >
        {busy ? "Charging…" : `Charge ${formatMoney(amountCents)}`}
      </button>
      {amountCents < 50 && <p className="text-xs text-zinc-500">Card payments must be at least $0.50.</p>}
      {error && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

/**
 * Manually-keyed card entry — typed card number/exp/CVC, charged through
 * Stripe directly. A stopgap for a register with no paired Terminal reader
 * yet. Same onPaid/paid contract as CardReaderPanel so the parent doesn't
 * care which one collected the card.
 */
export function ManualCardPanel(props: {
  amountCents: number;
  beforeCharge?: () => Promise<void>;
  onPaid: (p: CardPaid) => void;
  paid: CardPaid | null;
}) {
  return (
    <Elements stripe={getStripe()}>
      <ManualCardInner {...props} />
    </Elements>
  );
}
