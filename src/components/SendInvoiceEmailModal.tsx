"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError } from "@/lib/client";

/** Emails one invoice to a customer through the server (Brevo). */
export function SendInvoiceEmailModal({
  saleId,
  label,
  defaultTo = "",
  onClose,
}: {
  saleId: string;
  label: string;
  defaultTo?: string;
  onClose: () => void;
}) {
  const [to, setTo] = useState(defaultTo);
  const [message, setMessage] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ configured: boolean }>(`/api/sales/${saleId}/email`)
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(null));
  }, [saleId]);

  async function send() {
    setError(null);
    setSending(true);
    try {
      await api(`/api/sales/${saleId}/email`, {
        method: "POST",
        body: JSON.stringify({ to: to.trim(), message: message.trim() || undefined }),
      });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send the email");
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div
      className="no-print fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-base font-semibold">Email invoice {label}</h2>
        {sent ? (
          <>
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
              ✓ Sent to {to.trim()}.
            </p>
            <button onClick={onClose} className="btn-primary mt-4 w-full">
              Done
            </button>
          </>
        ) : (
          <>
            {configured === false && (
              <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Email isn&rsquo;t set up on the server yet (BREVO_API_KEY / BREVO_SENDER_EMAIL).
              </p>
            )}
            {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <label className="label">To</label>
            <input
              className="input"
              type="email"
              autoFocus
              placeholder="customer@example.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <label className="label mt-3">Message (optional)</label>
            <textarea
              className="input min-h-20"
              placeholder="Added above the invoice, e.g. “Thanks for your order!”"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="mt-4 flex gap-2">
              <button onClick={onClose} className="btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={send}
                disabled={sending || !to.trim() || configured === false}
                className="btn-primary flex-1"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
