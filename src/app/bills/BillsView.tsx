"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { BILL_TERMS } from "@/lib/terms";
import type { Bill } from "@/lib/types";

const FILTERS = ["ALL", "OPEN", "OVERDUE", "PAID"] as const;
type Filter = (typeof FILTERS)[number];

function fmtDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString() : "—";
}
function daysFromNow(s: string | null) {
  if (!s) return null;
  return Math.round((new Date(s).getTime() - Date.now()) / 86_400_000);
}

export function BillsView({ canManage }: { canManage: boolean }) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs =
        filter === "ALL"
          ? ""
          : filter === "OVERDUE"
            ? "?overdue=1"
            : `?status=${filter}`;
      const res = await api<{ bills: Bill[] }>(`/api/bills${qs}`);
      setBills(res.bills);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load bills");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const totalOpen = useMemo(
    () => bills.filter((b) => b.status === "OPEN").reduce((s, b) => s + b.subtotalCents, 0),
    [bills],
  );

  return (
    <div className="w-full flex-1 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Bills</h1>
        <span className="text-sm text-zinc-400">
          {bills.filter((b) => b.status === "OPEN").length} open · {formatMoney(totalOpen)} payable
        </span>
        <div className="ml-auto flex gap-1 rounded-md bg-zinc-100 p-1 text-sm">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 font-medium ${
                filter === f ? "bg-white shadow-sm" : "text-zinc-500"
              }`}
            >
              {f[0] + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 text-xs text-zinc-400">
        Bills are created when you receive items on a purchase order.
      </p>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5">Bill #</th>
              <th className="px-4 py-2.5">Vendor</th>
              <th className="px-4 py-2.5">PO</th>
              <th className="px-4 py-2.5">Store</th>
              <th className="px-4 py-2.5">Bill date</th>
              <th className="px-4 py-2.5">Terms</th>
              <th className="px-4 py-2.5">Due</th>
              <th className="px-4 py-2.5 text-right">Amount</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : bills.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-zinc-400">
                  No bills{filter === "ALL" ? "" : ` (${filter.toLowerCase()})`}.
                </td>
              </tr>
            ) : (
              bills.map((b) => {
                const d = daysFromNow(b.dueDate);
                const overdue = b.status === "OPEN" && d !== null && d < 0;
                return (
                  <tr
                    key={b.id}
                    onClick={() => setOpenId(b.id)}
                    className="cursor-pointer hover:bg-zinc-50"
                  >
                    <td className="px-4 py-2.5 font-medium">{b.billNumber || "—"}</td>
                    <td className="px-4 py-2.5">{b.vendor}</td>
                    <td className="px-4 py-2.5 font-mono text-zinc-500">{b.po?.poNumber ?? "—"}</td>
                    <td className="px-4 py-2.5 text-zinc-500">
                      {b.store?.name.replace(/^Chef and Beyond - /, "") ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500">{fmtDate(b.billDate)}</td>
                    <td className="px-4 py-2.5 text-zinc-500">{b.terms || "—"}</td>
                    <td className={`px-4 py-2.5 ${overdue ? "font-medium text-red-600" : "text-zinc-500"}`}>
                      {fmtDate(b.dueDate)}
                      {b.status === "OPEN" && d !== null && (
                        <span className="ml-1 text-xs">
                          ({d < 0 ? `${-d}d late` : d === 0 ? "today" : `${d}d`})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {formatMoney(b.subtotalCents)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          b.status === "PAID"
                            ? "bg-green-100 text-green-700"
                            : overdue
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {overdue ? "OVERDUE" : b.status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {openId && (
        <BillDetailModal
          billId={openId}
          canManage={canManage}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function BillDetailModal({
  billId,
  canManage,
  onClose,
  onChanged,
}: {
  billId: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [bill, setBill] = useState<Bill | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState({ billNumber: "", terms: "", dueDate: "", memo: "" });

  const load = useCallback(async () => {
    try {
      const res = await api<{ bill: Bill }>(`/api/bills/${billId}`);
      setBill(res.bill);
      setEdit({
        billNumber: res.bill.billNumber,
        terms: res.bill.terms,
        dueDate: res.bill.dueDate ? res.bill.dueDate.slice(0, 10) : "",
        memo: res.bill.memo,
      });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load bill");
    }
  }, [billId]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/bills/${billId}`, { method: "PATCH", body: JSON.stringify(body) });
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this bill? Its received quantities and inventory will be reversed.")) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/bills/${billId}`, { method: "DELETE" });
      onChanged();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {!bill ? (
          <p className="text-sm text-zinc-500">{err ?? "Loading…"}</p>
        ) : (
          <>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Bill {bill.billNumber ? `#${bill.billNumber}` : ""} · {bill.vendor}
              </h2>
              <button onClick={onClose} className="btn-ghost px-2 py-1 text-sm">
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm text-zinc-500">
              PO <span className="font-mono">{bill.po?.poNumber ?? "—"}</span> ·{" "}
              {bill.store?.name ?? "—"} · from {bill.createdBy?.name ?? "—"} on{" "}
              {fmtDate(bill.createdAt)}
            </p>

            {err && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              <div>
                <label className="label">Bill no.</label>
                <input
                  className="input"
                  value={edit.billNumber}
                  disabled={!canManage}
                  onChange={(e) => setEdit({ ...edit, billNumber: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Terms</label>
                <select
                  className="input"
                  value={edit.terms}
                  disabled={!canManage}
                  onChange={(e) => setEdit({ ...edit, terms: e.target.value })}
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
                  value={edit.dueDate}
                  disabled={!canManage}
                  onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Bill date</label>
                <input className="input" value={fmtDate(bill.billDate)} disabled />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
                  <tr>
                    <th className="py-1.5">Item</th>
                    <th className="py-1.5 text-right">Qty</th>
                    <th className="py-1.5 text-right">Unit cost</th>
                    <th className="py-1.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {(bill.items ?? []).map((it) => (
                    <tr key={it.id}>
                      <td className="py-2">
                        {it.nameSnapshot}
                        <span className="ml-1 text-xs text-zinc-400">{it.skuSnapshot}</span>
                      </td>
                      <td className="py-2 text-right tabular-nums">{it.quantity}</td>
                      <td className="py-2 text-right">{formatMoney(it.unitCostCents)}</td>
                      <td className="py-2 text-right font-medium">{formatMoney(it.lineCostCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="py-2 text-right font-medium">
                      Total
                    </td>
                    <td className="py-2 text-right text-base font-bold">
                      {formatMoney(bill.subtotalCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-3">
              <label className="label">Memo</label>
              <textarea
                className="input"
                rows={2}
                value={edit.memo}
                disabled={!canManage}
                onChange={(e) => setEdit({ ...edit, memo: e.target.value })}
              />
            </div>

            {canManage && (
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    patch({
                      billNumber: edit.billNumber.trim(),
                      terms: edit.terms,
                      dueDate: edit.dueDate || null,
                      memo: edit.memo.trim(),
                    })
                  }
                  disabled={busy}
                  className="btn-secondary"
                >
                  Save changes
                </button>
                {bill.status === "OPEN" ? (
                  <button
                    onClick={() => patch({ status: "PAID" })}
                    disabled={busy}
                    className="btn-primary"
                  >
                    Mark paid
                  </button>
                ) : (
                  <button
                    onClick={() => patch({ status: "OPEN" })}
                    disabled={busy}
                    className="btn-secondary"
                  >
                    Reopen
                  </button>
                )}
                <button onClick={remove} disabled={busy} className="btn-ghost text-red-500">
                  Delete bill
                </button>
              </div>
            )}
            {!canManage && (
              <p className="mt-4 text-xs text-zinc-400">
                Status: {bill.status}
                {bill.paidAt ? ` · paid ${fmtDate(bill.paidAt)}` : ""}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
