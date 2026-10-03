"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";

/**
 * "Email invoice" — sends the invoice/receipt PDF to the customer. Opens a
 * small panel with the recipient prefilled (editable) so staff can confirm
 * or redirect it before it goes out. Hidden when the server has no email
 * provider configured, so it never shows a button that can't work.
 */
export function EmailInvoiceButton({
  saleId,
  defaultEmail = "",
  className = "btn-secondary px-3 py-1 text-sm",
  label = "Email invoice",
}: {
  saleId: string;
  defaultEmail?: string;
  className?: string;
  label?: string;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    api<{ configured: boolean }>(`/api/sales/${saleId}/email`)
      .then((r) => alive && setConfigured(r.configured))
      .catch(() => alive && setConfigured(false));
    return () => {
      alive = false;
    };
  }, [saleId]);

  // Follow the prefill when the invoice (or its customer email) changes.
  const [prevDefault, setPrevDefault] = useState(defaultEmail);
  if (prevDefault !== defaultEmail) {
    setPrevDefault(defaultEmail);
    setTo(defaultEmail);
  }

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!configured) return null;

  async function send() {
    const addr = to.trim();
    if (!addr) {
      setErr("Enter an email address.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ ok: boolean; to: string }>(`/api/sales/${saleId}/email`, {
        method: "POST",
        body: JSON.stringify({ to: addr }),
      });
      setSentTo(r.to);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not send the email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setErr(null);
        }}
        className={className}
        title="Email this invoice as a PDF"
      >
        {sentTo ? "Sent ✓" : label}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-zinc-200 bg-white p-3 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <label className="label">Send PDF to</label>
          <input
            ref={inputRef}
            type="email"
            className="input w-full"
            placeholder="customer@example.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void send();
              }
              if (e.key === "Escape") setOpen(false);
            }}
            disabled={busy}
          />
          {err ? <p className="mt-1 text-xs text-red-600">{err}</p> : null}
          {sentTo ? <p className="mt-1 text-xs text-emerald-700">Already sent to {sentTo}.</p> : null}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn-ghost px-3 py-1 text-sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn-primary px-3 py-1 text-sm" onClick={() => void send()} disabled={busy}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
