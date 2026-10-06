"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { MoneyInput } from "@/components/MoneyInput";
import { BillAdjustments, type BillAdjustmentValues } from "@/components/BillAdjustments";
import { earlyPayDiscountCents } from "@/lib/billFees";
import { BILL_TERMS, dueDateFromTerms } from "@/lib/terms";
import type { PurchaseOrder, SessionUser, Store } from "@/lib/types";

type Line = {
  id: string;
  name: string;
  sku: string;
  hasProduct: boolean;
  ordered: number;
  received: number;
  now: string; // receive-and-bill qty
  costCents: number;
};

// Keeps an in-progress receive-and-bill across an accidental sign-out (the
// idle timer, a dropped session) — nothing entered (received quantities,
// cost overrides, fees...) is lost logging back in. One slot per PO per
// browser, keyed to the signed-in user so a different person on the same
// device doesn't inherit it.
const draftKey = (poId: string) => `cbpos.billDraft.${poId}`;

type BillDraft = {
  userId: string;
  poId: string;
  billNumber: string;
  billDate: string;
  terms: string;
  dueDate: string;
  dueTouched: boolean;
  memo: string;
  adj: BillAdjustmentValues;
  storeId: string;
  // Only the parts of each line a person actually edits — matched back onto
  // whatever lines load() fetches fresh from the server, by id, so a line
  // someone else already fully received in the meantime (and so dropped off
  // the outstanding list) doesn't reappear.
  lineOverrides: Record<string, { now: string; costCents: number }>;
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Copy a purchase order to a vendor bill — receiving whatever quantity is
 * entered and recording the bill for it in the same step. A PO is often
 * received and billed in more than one pass (a partial shipment, goods from
 * a different location, an invoice that follows later), so this only ever
 * shows what's still outstanding — a line already fully received drops off
 * the list — and can be opened again for whatever arrives next.
 */
export function BillModal({
  poId,
  onClose,
  onDone,
}: {
  poId: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Admins can direct the received stock to any store; it defaults to the PO's
  // "Ship to" store (falling back to the store that raised the PO).
  const [isAdmin, setIsAdmin] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");

  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(todayISO());
  const [terms, setTerms] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  const [memo, setMemo] = useState("");
  const [adj, setAdj] = useState<BillAdjustmentValues>({
    shippingCents: 0,
    minOrderFeeCents: 0,
    dropShipFeeCents: 0,
    processingFeeBps: 0,
    processingFeeCents: 0,
    earlyPayDiscountBps: 0,
    vendorCreditCents: 0,
  });
  const draftHydrated = useRef(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [res, meRes] = await Promise.all([
        api<{ purchaseOrder: PurchaseOrder }>(`/api/purchase-orders/${poId}`),
        api<{ user: SessionUser | null }>("/api/auth/me"),
      ]);
      const purchaseOrder = res.purchaseOrder;
      setPo(purchaseOrder);
      setSessionUserId(meRes.user?.id ?? null);
      setStoreId(purchaseOrder.storeId ?? "");
      // The PO's shipping and drop-ship fee belong on its first bill; pre-fill
      // them there (editable) so they're booked once as operating expenses.
      if ((purchaseOrder.bills?.length ?? 0) === 0) {
        setAdj((a) => ({
          ...a,
          shippingCents: purchaseOrder.shippingCents ?? 0,
          dropShipFeeCents: purchaseOrder.dropShipFeeCents ?? 0,
        }));
      }
      // Carry the PO's own date and due date over automatically — a vendor
      // bill is naturally dated to when the order was placed / due, not to
      // whenever someone happens to get around to copying it to a bill.
      if (purchaseOrder.terms) setTerms(purchaseOrder.terms);
      if (purchaseOrder.poDate) setBillDate(toISO(new Date(purchaseOrder.poDate)));
      if (purchaseOrder.dueDate) {
        setDueDate(toISO(new Date(purchaseOrder.dueDate)));
        setDueTouched(true);
      }
      // Only what's still outstanding — a line already fully received has
      // nothing left to copy to this (or any later) bill.
      setLines(
        (purchaseOrder.items ?? [])
          .filter((it) => it.quantity - it.receivedQuantity > 0)
          .map((it) => ({
            id: it.id,
            name: it.nameSnapshot || "—",
            sku: it.skuSnapshot,
            hasProduct: !!it.productId,
            ordered: it.quantity,
            received: it.receivedQuantity,
            now: String(Math.max(0, it.quantity - it.receivedQuantity)),
            costCents: it.unitCostCents,
          })),
      );

      if (meRes.user?.role === "ADMIN") {
        setIsAdmin(true);
        const { stores: list } = await api<{ stores: Store[] }>("/api/stores");
        setStores(list);
        // Default the picker to the PO's "Ship to" store when it names one of ours.
        const shipTo = purchaseOrder.shipTo?.trim().toLowerCase();
        const match = shipTo ? list.find((s) => s.name.trim().toLowerCase() === shipTo) : undefined;
        setStoreId(match?.id ?? purchaseOrder.storeId ?? list[0]?.id ?? "");
      }

      // Restore an in-progress draft left from before a sign-out/reload, on
      // top of whatever was just loaded fresh from the server — applied last
      // so it wins over the PO's own defaults.
      try {
        const raw = localStorage.getItem(draftKey(poId));
        if (raw) {
          const d = JSON.parse(raw) as Partial<BillDraft>;
          if (d.userId !== meRes.user?.id || d.poId !== poId) {
            localStorage.removeItem(draftKey(poId));
          } else {
            setDraftRestored(true);
            if (d.billNumber !== undefined) setBillNumber(d.billNumber);
            if (d.billDate !== undefined) setBillDate(d.billDate);
            if (d.terms !== undefined) setTerms(d.terms);
            if (d.dueDate !== undefined) setDueDate(d.dueDate);
            if (d.dueTouched !== undefined) setDueTouched(d.dueTouched);
            if (d.memo !== undefined) setMemo(d.memo);
            if (d.adj !== undefined) setAdj(d.adj);
            if (d.storeId !== undefined) setStoreId(d.storeId);
            if (d.lineOverrides) {
              const overrides = d.lineOverrides;
              setLines((cur) =>
                cur.map((l) => (overrides[l.id] ? { ...l, ...overrides[l.id] } : l)),
              );
            }
          }
        }
      } catch {
        /* ignore malformed/unavailable storage */
      }
      draftHydrated.current = true;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load purchase order");
    }
  }, [poId]);

  useEffect(() => {
    load();
  }, [load]);

  // Terms drive the due date until the user picks one by hand.
  useEffect(() => {
    if (dueTouched) return;
    const d = dueDateFromTerms(new Date(billDate || todayISO()), terms);
    setDueDate(d ? toISO(d) : "");
  }, [terms, billDate, dueTouched]);

  // Save the draft on every change; drop it once there's nothing worth
  // keeping (nothing's actually being received/billed yet).
  useEffect(() => {
    if (!draftHydrated.current) return;
    try {
      const key = draftKey(poId);
      const hasContent =
        billNumber.trim() !== "" ||
        memo.trim() !== "" ||
        lines.some((l) => (parseInt(l.now || "0", 10) || 0) > 0);
      if (!hasContent) {
        localStorage.removeItem(key);
        return;
      }
      const lineOverrides: BillDraft["lineOverrides"] = {};
      for (const l of lines) lineOverrides[l.id] = { now: l.now, costCents: l.costCents };
      const draft: BillDraft = {
        userId: sessionUserId ?? "",
        poId,
        billNumber,
        billDate,
        terms,
        dueDate,
        dueTouched,
        memo,
        adj,
        storeId,
        lineOverrides,
      };
      localStorage.setItem(key, JSON.stringify(draft));
    } catch {
      /* storage full or unavailable — non-fatal */
    }
  }, [poId, sessionUserId, billNumber, billDate, terms, dueDate, dueTouched, memo, adj, storeId, lines]);

  function setNow(id: string, raw: string) {
    setLines((cur) => cur.map((l) => (l.id === id ? { ...l, now: raw.replace(/[^0-9-]/g, "") } : l)));
  }
  function setCost(id: string, cents: number) {
    setLines((cur) => cur.map((l) => (l.id === id ? { ...l, costCents: cents } : l)));
  }
  function fillRemaining() {
    setLines((cur) => cur.map((l) => ({ ...l, now: String(Math.max(0, l.ordered - l.received)) })));
  }

  const itemsTotal = lines.reduce((s, l) => s + (parseInt(l.now || "0", 10) || 0) * l.costCents, 0);
  // Tax and any "other cost" expenses logged on the PO are one-time charges —
  // the first bill against this PO picks them up automatically; a later bill
  // doesn't repeat them. (Shipping / drop-ship are in the fee inputs below.)
  const isFirstBill = (po?.bills?.length ?? 0) === 0;
  const poExtraChargesCents =
    (po?.taxCents ?? 0) + (po?.expenses?.reduce((s, e) => s + e.amountCents, 0) ?? 0);
  const extraChargesCents = isFirstBill ? poExtraChargesCents : 0;
  const feesCents =
    adj.shippingCents + adj.minOrderFeeCents + adj.dropShipFeeCents + adj.processingFeeCents;
  const discountCents = earlyPayDiscountCents(itemsTotal, adj.earlyPayDiscountBps);
  const creditCents = adj.vendorCreditCents;
  const total = itemsTotal + extraChargesCents + feesCents - discountCents - creditCents;
  const hasBreakdown = extraChargesCents + feesCents + discountCents + creditCents > 0;

  async function submit() {
    const payload = lines
      .map((l) => ({
        itemId: l.id,
        receiveQty: parseInt(l.now || "0", 10) || 0,
        unitCostCents: l.costCents,
      }))
      .filter((l) => l.receiveQty !== 0);
    if (payload.length === 0) {
      setErr("Enter a quantity on at least one line.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/purchase-orders/${poId}/bills`, {
        method: "POST",
        body: JSON.stringify({
          recordBill: true,
          receiveItems: true,
          billNumber: billNumber.trim(),
          billDate,
          dueDate: dueDate || null,
          terms,
          memo: memo.trim(),
          ...adj,
          ...(isAdmin && storeId ? { storeId } : {}),
          lines: payload,
        }),
      });
      try {
        localStorage.removeItem(draftKey(poId));
      } catch {
        /* ignore */
      }
      onDone?.();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto p-6">
        {!po ? (
          <p className="text-sm text-zinc-500">{err ?? "Loading…"}</p>
        ) : (
          <>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Copy to bill · <span className="font-mono">{po.poNumber}</span>
              </h2>
              <button onClick={onClose} className="btn-ghost px-2 py-1 text-sm">
                ✕
              </button>
            </div>
            {draftRestored && (
              <p className="mb-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Restored your unsaved receiving/billing entries from before — nothing was lost.{" "}
                <button
                  type="button"
                  onClick={() => {
                    try {
                      localStorage.removeItem(draftKey(poId));
                    } catch {
                      /* ignore */
                    }
                    setDraftRestored(false);
                    load();
                  }}
                  className="font-medium underline"
                >
                  Discard it and start over
                </button>
                .
              </p>
            )}
            <p className="mb-4 text-sm text-zinc-500">
              {po.vendor} — the quantity entered below is received{" "}
              {isAdmin ? (
                <>into the store chosen below</>
              ) : (
                <>
                  into{" "}
                  <span className="font-medium text-zinc-700">
                    {po.shipTo?.trim() ? `${po.shipTo.trim()}’s` : "the ordering store’s"}
                  </span>{" "}
                  inventory (the &ldquo;Ship to&rdquo; store)
                </>
              )}{" "}
              and billed together.
            </p>

            {!isFirstBill && poExtraChargesCents > 0 && (
              <p className="mb-4 text-xs text-zinc-400">
                This PO&rsquo;s tax and other logged costs (
                {formatMoney(poExtraChargesCents)}) were already added to its first bill — not
                repeated here.
              </p>
            )}

            {isAdmin && (
              <div className="mb-4">
                <label className="label">Receive into store</label>
                <select
                  className="input sm:max-w-xs"
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                >
                  <option value="">Select a store…</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  Defaults to the &ldquo;Ship to&rdquo; store
                  {po.shipTo?.trim() ? ` (${po.shipTo.trim()})` : ""}.
                </p>
              </div>
            )}

            {err && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              <div>
                <label className="label">Bill no.</label>
                <input
                  className="input"
                  placeholder="Vendor invoice #"
                  value={billNumber}
                  onChange={(e) => setBillNumber(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Bill date</label>
                <input
                  type="date"
                  className="input"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Terms</label>
                <select
                  className="input"
                  value={terms}
                  onChange={(e) => {
                    setDueTouched(false);
                    setTerms(e.target.value);
                  }}
                >
                  <option value="">— None —</option>
                  {BILL_TERMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Due date</label>
                <input
                  type="date"
                  className="input"
                  value={dueDate}
                  onChange={(e) => {
                    setDueTouched(true);
                    setDueDate(e.target.value);
                  }}
                />
              </div>
            </div>

            {lines.length === 0 ? (
              <p className="text-sm text-zinc-400">
                {(po.items ?? []).length === 0
                  ? "This purchase order has no item lines."
                  : "Everything on this purchase order has already been received and billed."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
                    <tr>
                      <th className="py-1.5">Item</th>
                      <th className="py-1.5 text-right">Ordered</th>
                      <th className="py-1.5 text-right">Already in</th>
                      <th className="py-1.5 text-right">Bill qty</th>
                      <th className="py-1.5 text-right">Unit cost</th>
                      <th className="py-1.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {lines.map((l) => {
                      const q = parseInt(l.now || "0", 10) || 0;
                      return (
                        <tr key={l.id}>
                          <td className="py-2">
                            {l.name}
                            <span className="ml-1 text-xs text-zinc-400">{l.sku}</span>
                            {!l.hasProduct && (
                              <span className="ml-1 text-[11px] text-amber-600">
                                (no product — bill only)
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums">{l.ordered}</td>
                          <td className="py-2 text-right tabular-nums text-zinc-500">{l.received}</td>
                          <td className="py-2 text-right">
                            <input
                              className="input h-8 w-20 text-right"
                              inputMode="numeric"
                              value={l.now}
                              onChange={(e) => setNow(l.id, e.target.value)}
                            />
                          </td>
                          <td className="py-2 text-right">
                            <MoneyInput
                              cents={l.costCents}
                              onCentsChange={(c) => setCost(l.id, c)}
                              className="input h-8 w-24 text-right"
                            />
                          </td>
                          <td className="py-2 text-right font-medium tabular-nums">
                            {formatMoney(q * l.costCents)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {hasBreakdown && (
                      <>
                        <tr>
                          <td colSpan={5} className="pt-2 text-right text-zinc-500">
                            Items
                          </td>
                          <td className="pt-2 text-right tabular-nums text-zinc-500">
                            {formatMoney(itemsTotal)}
                          </td>
                        </tr>
                        {extraChargesCents > 0 && (
                          <tr>
                            <td colSpan={5} className="py-1 text-right text-zinc-500">
                              Tax &amp; other logged costs
                            </td>
                            <td className="py-1 text-right tabular-nums text-zinc-500">
                              {formatMoney(extraChargesCents)}
                            </td>
                          </tr>
                        )}
                        {feesCents > 0 && (
                          <tr>
                            <td colSpan={5} className="py-1 text-right text-zinc-500">
                              Shipping &amp; fees
                            </td>
                            <td className="py-1 text-right tabular-nums text-zinc-500">
                              {formatMoney(feesCents)}
                            </td>
                          </tr>
                        )}
                        {discountCents > 0 && (
                          <tr>
                            <td colSpan={5} className="py-1 text-right text-zinc-500">
                              Early-pay discount ({adj.earlyPayDiscountBps / 100}%)
                            </td>
                            <td className="py-1 text-right tabular-nums text-green-700">
                              -{formatMoney(discountCents)}
                            </td>
                          </tr>
                        )}
                        {creditCents > 0 && (
                          <tr>
                            <td colSpan={5} className="py-1 text-right text-zinc-500">
                              Vendor credit
                            </td>
                            <td className="py-1 text-right tabular-nums text-green-700">
                              -{formatMoney(creditCents)}
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                    <tr>
                      <td colSpan={5} className="py-2 text-right font-medium">
                        Bill total
                      </td>
                      <td className="py-2 text-right text-base font-bold">{formatMoney(total)}</td>
                    </tr>
                  </tfoot>
                </table>
                <button onClick={fillRemaining} className="btn-ghost mt-1 text-xs text-indigo-600">
                  Fill remaining
                </button>
              </div>
            )}

            <BillAdjustments values={adj} onChange={setAdj} itemsCents={itemsTotal} />

            <div className="mt-4">
              <label className="label">Memo</label>
              <textarea
                className="input"
                rows={2}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>

            {isAdmin && !storeId && (
              <p className="mt-4 text-xs text-amber-600">Choose a store to receive into.</p>
            )}
            <div className="mt-5 flex gap-2">
              <button onClick={onClose} className="btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || lines.length === 0 || (isAdmin && !storeId)}
                className="btn-primary flex-1"
              >
                {busy ? "Saving…" : "Receive & bill"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
