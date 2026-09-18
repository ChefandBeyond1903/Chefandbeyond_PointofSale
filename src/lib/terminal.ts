import "server-only";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { stripe, stripeConfigured, stripeTestMode } from "@/lib/stripe";

// Stripe Terminal, server-driven: the register tells Stripe to push a
// PaymentIntent to a reader, the customer taps/dips on the reader, and the
// register polls the intent until it succeeds. The sale is only written once
// the intent is verified paid (verifyPaidIntent), so the DB never records a
// card payment Stripe didn't actually collect.

export const TERMINAL_CURRENCY = "usd";

export type ReaderInfo = {
  id: string;
  storeId: string;
  storeName: string;
  label: string;
  deviceType: string;
  status: "online" | "offline" | "unknown";
};

export type ChargeStatus = {
  paymentIntentId: string;
  status: Stripe.PaymentIntent.Status;
  amountCents: number;
  // Best-effort message for the cashier when the reader action failed.
  failure: string;
  cardBrand: string;
  cardLast4: string;
};

/**
 * Split a one-line store address ("1010 Foster Ave, Nashville, TN 37210") into
 * the structured form Stripe requires for a Terminal Location. Returns null
 * when it can't be read confidently — the admin then fixes the store address.
 */
export function parseStoreAddress(
  raw: string,
): { line1: string; city: string; state: string; postal_code: string; country: "US" } | null {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const tail = parts[parts.length - 1];
  const m = tail.match(/^([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/);
  let state = "";
  let zip = "";
  let city = "";
  if (m) {
    state = m[1].toUpperCase();
    zip = m[2];
    city = parts.length >= 3 ? parts[parts.length - 2] : "";
  } else if (parts.length >= 4) {
    // "…, Nashville, TN, 37210"
    const z = parts[parts.length - 1].match(/^(\d{5})/);
    const st = parts[parts.length - 2].match(/^[A-Za-z]{2}$/);
    if (!z || !st) return null;
    zip = z[1];
    state = st[0].toUpperCase();
    city = parts[parts.length - 3];
  } else {
    return null;
  }
  if (!city) return null;
  const line1 = parts.slice(0, parts.indexOf(city)).join(", ") || parts[0];
  return { line1, city, state, postal_code: zip, country: "US" };
}

/** The store's Stripe Terminal Location, creating it on first use. */
export async function ensureLocation(storeId: string): Promise<string> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new HttpError(404, "Store not found");
  if (store.stripeLocationId) return store.stripeLocationId;
  const address = parseStoreAddress(store.address);
  if (!address) {
    throw new HttpError(
      400,
      `Enter ${store.name}'s address as "street, city, ST zip" under Settings → Stores before pairing a reader.`,
    );
  }
  const loc = await stripe().terminal.locations.create({
    display_name: store.name,
    address,
    metadata: { posStoreId: store.id },
  });
  await prisma.store.update({ where: { id: store.id }, data: { stripeLocationId: loc.id } });
  return loc.id;
}

/** Pair a reader with the pairing code shown on its screen. */
export async function registerReader(opts: {
  storeId: string;
  registrationCode: string;
  label: string;
}) {
  if (!stripeConfigured()) throw new HttpError(400, "Card readers aren't set up (no Stripe key).");
  const location = await ensureLocation(opts.storeId);
  let reader: Stripe.Terminal.Reader;
  try {
    reader = await stripe().terminal.readers.create({
      registration_code: opts.registrationCode.trim(),
      label: opts.label.trim(),
      location,
    });
  } catch (err) {
    throw new HttpError(400, `Stripe couldn't pair that reader: ${stripeMessage(err)}`);
  }
  return prisma.cardReader.upsert({
    where: { stripeReaderId: reader.id },
    create: {
      storeId: opts.storeId,
      stripeReaderId: reader.id,
      label: opts.label.trim(),
      deviceType: reader.device_type,
    },
    update: { storeId: opts.storeId, label: opts.label.trim(), deviceType: reader.device_type, active: true },
  });
}

/** Readers for the given stores (all stores when `storeIds` is null), with live status. */
export async function listReaders(storeIds: string[] | null): Promise<ReaderInfo[]> {
  const rows = await prisma.cardReader.findMany({
    where: { active: true, ...(storeIds ? { storeId: { in: storeIds } } : {}) },
    include: { store: { select: { name: true } } },
    orderBy: [{ store: { name: "asc" } }, { label: "asc" }],
  });
  if (rows.length === 0) return [];
  const status = new Map<string, "online" | "offline">();
  if (stripeConfigured()) {
    try {
      // One list call covers every reader on the account (paged at 100).
      for await (const r of stripe().terminal.readers.list({ limit: 100 })) {
        status.set(r.id, r.status === "online" ? "online" : "offline");
      }
    } catch {
      // Status stays "unknown" — the readers are still usable.
    }
  }
  return rows.map((r) => ({
    id: r.id,
    storeId: r.storeId,
    storeName: r.store.name,
    label: r.label,
    deviceType: r.deviceType,
    status: status.get(r.stripeReaderId) ?? "unknown",
  }));
}

export async function removeReader(id: string) {
  const row = await prisma.cardReader.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Reader not found");
  try {
    await stripe().terminal.readers.del(row.stripeReaderId);
  } catch (err) {
    // Already gone on Stripe's side is fine; anything else should surface.
    if (!/No such terminal.reader/i.test(stripeMessage(err))) {
      throw new HttpError(400, `Stripe couldn't remove the reader: ${stripeMessage(err)}`);
    }
  }
  await prisma.cardReader.delete({ where: { id } });
}

/**
 * Start collecting `amountCents` on a reader: create the PaymentIntent and
 * hand it to the reader. Returns the intent id the register polls.
 */
export async function startCharge(opts: {
  readerId: string;
  amountCents: number;
  cashierId: string;
  description: string;
}): Promise<{ paymentIntentId: string; readerLabel: string }> {
  if (!stripeConfigured()) throw new HttpError(400, "Card readers aren't set up (no Stripe key).");
  if (!Number.isInteger(opts.amountCents) || opts.amountCents < 50) {
    throw new HttpError(400, "Card payments must be at least $0.50.");
  }
  const reader = await prisma.cardReader.findUnique({ where: { id: opts.readerId, active: true } });
  if (!reader) throw new HttpError(404, "That card reader is no longer paired.");
  const s = stripe();
  const intent = await s.paymentIntents.create({
    amount: opts.amountCents,
    currency: TERMINAL_CURRENCY,
    payment_method_types: ["card_present"],
    capture_method: "automatic",
    description: opts.description,
    metadata: { posStoreId: reader.storeId, posCashierId: opts.cashierId, posReaderId: reader.id },
  });
  try {
    await s.terminal.readers.processPaymentIntent(reader.stripeReaderId, {
      payment_intent: intent.id,
      process_config: { skip_tipping: true },
    });
  } catch (err) {
    // The reader is busy/offline — don't leave a dangling intent behind.
    await s.paymentIntents.cancel(intent.id).catch(() => undefined);
    throw new HttpError(400, `The reader didn't accept the payment: ${stripeMessage(err)}`);
  }
  return { paymentIntentId: intent.id, readerLabel: reader.label };
}

/** Current state of a charge the register started. */
export async function chargeStatus(paymentIntentId: string): Promise<ChargeStatus> {
  const s = stripe();
  const intent = await s.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  const card = cardDetails(intent);
  let failure = "";
  if (intent.status !== "succeeded") {
    const readerId = intent.metadata?.posReaderId;
    const row = readerId ? await prisma.cardReader.findUnique({ where: { id: readerId } }) : null;
    if (row) {
      const reader = await s.terminal.readers.retrieve(row.stripeReaderId);
      const action = (reader as Stripe.Terminal.Reader).action;
      if (action && action.status === "failed") {
        failure = action.failure_message || "The card was declined or the payment was cancelled on the reader.";
      }
    }
    if (!failure && intent.last_payment_error?.message) failure = intent.last_payment_error.message;
  }
  return {
    paymentIntentId: intent.id,
    status: intent.status,
    amountCents: intent.amount,
    failure,
    cardBrand: card.brand,
    cardLast4: card.last4,
  };
}

/** Stop a charge in progress: clear the reader's screen and void the intent. */
export async function cancelCharge(paymentIntentId: string) {
  const s = stripe();
  const intent = await s.paymentIntents.retrieve(paymentIntentId);
  if (intent.status === "succeeded") {
    throw new HttpError(409, "That payment already went through. Refund it from the sale instead.");
  }
  const readerId = intent.metadata?.posReaderId;
  const row = readerId ? await prisma.cardReader.findUnique({ where: { id: readerId } }) : null;
  if (row) await s.terminal.readers.cancelAction(row.stripeReaderId).catch(() => undefined);
  if (intent.status !== "canceled") await s.paymentIntents.cancel(intent.id).catch(() => undefined);
}

/**
 * Before a card payment is written to a sale: confirm the intent is paid, for
 * exactly this amount, and not already attached to another sale. Returns the
 * card details for the receipt.
 */
export async function verifyPaidIntent(
  paymentIntentId: string,
  amountCents: number,
): Promise<{ cardBrand: string; cardLast4: string }> {
  if (!stripeConfigured()) throw new HttpError(400, "Card readers aren't set up (no Stripe key).");
  const used = await prisma.salePayment.findUnique({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { saleId: true },
  });
  if (used) throw new HttpError(409, "That card payment is already recorded on another sale.");
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  } catch (err) {
    throw new HttpError(400, `Stripe couldn't find that card payment: ${stripeMessage(err)}`);
  }
  if (intent.status !== "succeeded") {
    throw new HttpError(400, "The card payment hasn't gone through on the reader yet.");
  }
  if (intent.amount !== amountCents || intent.currency !== TERMINAL_CURRENCY) {
    throw new HttpError(
      400,
      `The card was charged ${(intent.amount / 100).toFixed(2)} but the sale needs ${(amountCents / 100).toFixed(2)}.`,
    );
  }
  return cardDetails(intent);
}

/**
 * Refund `amountCents` of a sale back to the card(s) it was paid on, spread
 * across its Stripe-backed CARD payments in order. Runs BEFORE the refund is
 * recorded in the DB so a Stripe failure leaves nothing half-done. Returns
 * the Stripe refund ids.
 */
export async function refundCardPayments(
  payments: { stripePaymentIntentId: string | null; amountCents: number }[],
  amountCents: number,
): Promise<string[]> {
  const s = stripe();
  let left = amountCents;
  const ids: string[] = [];
  for (const p of payments) {
    if (left <= 0) break;
    if (!p.stripePaymentIntentId) continue;
    const intent = await s.paymentIntents.retrieve(p.stripePaymentIntentId, { expand: ["latest_charge"] });
    const charge = intent.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    const remaining = intent.amount - (charge?.amount_refunded ?? 0);
    if (remaining <= 0) continue;
    const take = Math.min(remaining, left);
    ids.push(await refundIntent(p.stripePaymentIntentId, take));
    left -= take;
  }
  if (left > 0) {
    throw new HttpError(
      400,
      `Only ${((amountCents - left) / 100).toFixed(2)} of this sale was paid on a card reader — refund the rest as cash, check or store credit.`,
    );
  }
  return ids;
}

/** Refund (part of) a Terminal payment back to the card. */
export async function refundIntent(paymentIntentId: string, amountCents: number): Promise<string> {
  try {
    const refund = await stripe().refunds.create({ payment_intent: paymentIntentId, amount: amountCents });
    return refund.id;
  } catch (err) {
    throw new HttpError(400, `Stripe couldn't refund the card: ${stripeMessage(err)}`);
  }
}

/** Sandbox only: act as the customer tapping a test card on a simulated reader. */
export async function simulateTap(paymentIntentId: string) {
  if (!stripeTestMode()) throw new HttpError(400, "Only available with a sandbox Stripe key.");
  const s = stripe();
  const intent = await s.paymentIntents.retrieve(paymentIntentId);
  const readerId = intent.metadata?.posReaderId;
  const row = readerId ? await prisma.cardReader.findUnique({ where: { id: readerId } }) : null;
  if (!row) throw new HttpError(404, "Reader not found for that payment.");
  await s.testHelpers.terminal.readers.presentPaymentMethod(row.stripeReaderId, {
    type: "card_present",
    card_present: { number: "4242424242424242" },
  });
}

function cardDetails(intent: Stripe.PaymentIntent): { brand: string; last4: string; cardBrand: string; cardLast4: string } {
  const charge = intent.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  // A Terminal (card_present) tap/dip, or a manually-keyed online card — one
  // of the two is populated depending on how the card was charged.
  const card = charge?.payment_method_details?.card_present ?? charge?.payment_method_details?.card;
  const brand = card?.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : "";
  const last4 = card?.last4 ?? "";
  return { brand, last4, cardBrand: brand, cardLast4: last4 };
}

function stripeMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}
