"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client";
import { SignaturePad } from "@/components/SignaturePad";

type SignatureStatus = {
  signatureUrl: string | null;
  signedAt: string | null;
  signedByName: string;
};

/**
 * Delivery-signature capture/view for one invoice — hand the phone/tablet to
 * the customer at drop-off to sign that they received the equipment, and
 * pull it back up later to confirm. The image itself lives in private
 * storage; this only ever holds a short-lived signed URL once fetched.
 */
export function DeliverySignature({
  saleId,
  signedAt,
  signedByName,
  onSigned,
  canClear = false,
}: {
  saleId: string;
  signedAt: string | null | undefined;
  signedByName: string | undefined;
  onSigned: () => void;
  canClear?: boolean;
}) {
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [loadingView, setLoadingView] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function view() {
    setErr(null);
    setLoadingView(true);
    try {
      const res = await api<SignatureStatus>(`/api/sales/${saleId}/signature`);
      if (res.signatureUrl) setViewing(res.signatureUrl);
      else setErr("No signature on file.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load the signature");
    } finally {
      setLoadingView(false);
    }
  }

  async function save(dataUrl: string) {
    setSaving(true);
    setErr(null);
    try {
      await api(`/api/sales/${saleId}/signature`, {
        method: "POST",
        body: JSON.stringify({ dataUrl, signedByName: name.trim() }),
      });
      setCapturing(false);
      setName("");
      onSigned();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save the signature");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!confirm("Remove this delivery signature? This can't be undone.")) return;
    setErr(null);
    try {
      await api(`/api/sales/${saleId}/signature`, { method: "DELETE" });
      onSigned();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not remove the signature");
    }
  }

  return (
    <div className="mb-4 rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Delivery signature</p>
          {signedAt ? (
            <p className="text-xs text-zinc-500">
              Signed{signedByName ? ` by ${signedByName}` : ""} on{" "}
              {new Date(signedAt).toLocaleString()}
            </p>
          ) : (
            <p className="text-xs text-zinc-400">
              Not yet signed — hand the device to the customer at drop-off.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {signedAt && (
            <button
              onClick={view}
              disabled={loadingView}
              className="btn-ghost px-3 py-1 text-xs"
            >
              {loadingView ? "Loading…" : "View"}
            </button>
          )}
          <button onClick={() => setCapturing(true)} className="btn-secondary px-3 py-1 text-xs">
            {signedAt ? "Re-sign" : "Capture signature"}
          </button>
          {signedAt && canClear && (
            <button onClick={clear} className="btn-ghost px-3 py-1 text-xs text-red-500">
              Remove
            </button>
          )}
        </div>
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}

      {capturing && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4"
          onClick={() => !saving && setCapturing(false)}
        >
          <div className="card w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-sm font-medium">Customer signature</p>
            <input
              className="input mb-2 h-8"
              placeholder="Customer name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <SignaturePad onSave={save} onCancel={() => setCapturing(false)} saving={saving} />
          </div>
        </div>
      )}

      {viewing && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4"
          onClick={() => setViewing(null)}
        >
          <div className="card w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={viewing}
              alt="Customer signature"
              className="w-full rounded border border-zinc-200 bg-white"
            />
            <button onClick={() => setViewing(null)} className="btn-primary mt-3 w-full py-1.5 text-sm">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
