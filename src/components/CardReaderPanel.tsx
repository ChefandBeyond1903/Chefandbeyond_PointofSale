"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";

export type ReaderOption = {
  id: string;
  storeId: string;
  storeName: string;
  label: string;
  deviceType: string;
  status: "online" | "offline" | "unknown";
};

export type CardPaid = { paymentIntentId: string; cardBrand: string; cardLast4: string };

type ChargeStatus = {
  paymentIntentId: string;
  status: string;
  failure: string;
  cardBrand: string;
  cardLast4: string;
};

const READER_KEY = "cbpos.readerId";

/**
 * "Charge on the card reader" — pushes `amountCents` to a paired Stripe
 * Terminal reader and waits for the customer to tap/dip. Calls onPaid once
 * Stripe reports the charge succeeded; the parent then records the sale with
 * the PaymentIntent id. `beforeCharge` runs a validation pass (a dry-run of
 * the sale) so a card is never charged for a sale the server would reject.
 */
export function CardReaderPanel({
  amountCents,
  readers,
  testMode,
  description,
  beforeCharge,
  onPaid,
  paid,
}: {
  amountCents: number;
  readers: ReaderOption[];
  testMode: boolean;
  description: string;
  beforeCharge?: () => Promise<void>;
  onPaid: (p: CardPaid) => void;
  paid: CardPaid | null;
}) {
  const [readerId, setReaderId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(READER_KEY);
      if (saved && readers.some((r) => r.id === saved)) return saved;
    } catch {
      // storage unavailable
    }
    return readers[0]?.id ?? "";
  });
  const [phase, setPhase] = useState<"idle" | "starting" | "waiting" | "error">("idle");
  const [intentId, setIntentId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function pickReader(id: string) {
    setReaderId(id);
    try {
      localStorage.setItem(READER_KEY, id);
    } catch {
      // ignore
    }
  }

  async function poll(id: string) {
    if (!live.current) return;
    try {
      const s = await api<ChargeStatus>(`/api/terminal/charges/${id}`);
      if (!live.current) return;
      if (s.status === "succeeded") {
        setPhase("idle");
        setMessage("");
        onPaid({ paymentIntentId: s.paymentIntentId, cardBrand: s.cardBrand, cardLast4: s.cardLast4 });
        return;
      }
      if (s.status === "canceled") {
        setPhase("error");
        setMessage("The payment was cancelled.");
        setIntentId(null);
        return;
      }
      if (s.failure) {
        // Declined / cancelled on the reader. The intent stays open and the
        // cashier can push it to the reader again.
        setPhase("error");
        setMessage(s.failure);
        return;
      }
    } catch (err) {
      if (!live.current) return;
      setPhase("error");
      setMessage(err instanceof ApiError ? err.message : "Lost contact with the reader.");
      return;
    }
    timer.current = setTimeout(() => poll(id), 1500);
  }

  async function charge() {
    if (!readerId) return;
    setPhase("starting");
    setMessage("");
    try {
      if (beforeCharge) await beforeCharge();
      // Cancel a previous failed attempt before pushing a fresh intent.
      if (intentId) await api(`/api/terminal/charges/${intentId}`, { method: "DELETE" }).catch(() => undefined);
      const res = await api<{ paymentIntentId: string; readerLabel: string }>("/api/terminal/charges", {
        method: "POST",
        body: JSON.stringify({ readerId, amountCents, description }),
      });
      if (!live.current) return;
      setIntentId(res.paymentIntentId);
      setPhase("waiting");
      timer.current = setTimeout(() => poll(res.paymentIntentId), 1200);
    } catch (err) {
      if (!live.current) return;
      setPhase("error");
      setMessage(err instanceof ApiError ? err.message : "Couldn't start the card payment.");
    }
  }

  async function cancel() {
    if (timer.current) clearTimeout(timer.current);
    const id = intentId;
    setIntentId(null);
    setPhase("idle");
    setMessage("");
    if (id) await api(`/api/terminal/charges/${id}`, { method: "DELETE" }).catch(() => undefined);
  }

  async function simulate() {
    if (!intentId) return;
    try {
      await api(`/api/terminal/charges/${intentId}/simulate`, { method: "POST" });
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Simulation failed.");
    }
  }

  // Cancel an in-flight charge if the panel unmounts (modal closed).
  useEffect(() => {
    return () => {
      if (intentId && phase === "waiting") {
        fetch(`/api/terminal/charges/${intentId}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
      }
    };
  }, [intentId, phase]);

  if (paid) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
        <p className="font-semibold">Card approved — {formatMoney(amountCents)}</p>
        <p className="text-xs">
          {paid.cardBrand || "Card"}
          {paid.cardLast4 ? ` •••• ${paid.cardLast4}` : ""}
        </p>
      </div>
    );
  }

  const reader = readers.find((r) => r.id === readerId);

  return (
    <div className="space-y-2 rounded-md border border-zinc-200 p-3">
      {readers.length > 1 && (
        <div>
          <label className="label">Card reader</label>
          <select className="input" value={readerId} onChange={(e) => pickReader(e.target.value)} disabled={phase === "waiting"}>
            {readers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
                {r.status === "offline" ? " (offline)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      {readers.length === 1 && reader && (
        <p className="text-xs text-zinc-500">
          Reader: <span className="font-medium text-zinc-700">{reader.label}</span>
          {reader.status === "offline" ? <span className="text-red-600"> — offline</span> : null}
        </p>
      )}

      {phase === "waiting" ? (
        <div className="space-y-2">
          <p className="rounded-md bg-zinc-50 px-3 py-4 text-center text-sm text-zinc-700">
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            Waiting for the customer to tap or insert their card…
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={cancel} className="btn-secondary flex-1 text-sm">
              Cancel on reader
            </button>
            {testMode && (
              <button type="button" onClick={simulate} className="btn-ghost flex-1 text-xs" title="Sandbox only">
                Simulate tap (test)
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={charge}
          disabled={!readerId || phase === "starting" || amountCents < 50}
          className="btn-primary w-full"
        >
          {phase === "starting"
            ? "Sending to reader…"
            : phase === "error"
              ? `Try again — ${formatMoney(amountCents)}`
              : `Charge ${formatMoney(amountCents)} on reader`}
        </button>
      )}
      {amountCents < 50 && <p className="text-xs text-zinc-500">Card payments must be at least $0.50.</p>}
      {message && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{message}</p>}
    </div>
  );
}
