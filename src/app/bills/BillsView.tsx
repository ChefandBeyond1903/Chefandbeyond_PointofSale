"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { formatDateOnly, todayInputValue } from "@/lib/date";
import { MoneyInput } from "@/components/MoneyInput";
import { BillAdjustments, type BillAdjustmentValues } from "@/components/BillAdjustments";
import { earlyPayDiscountCents } from "@/lib/billFees";
import { VendorPicker } from "@/components/VendorPicker";
import { BILL_TERMS, dueDateFromTerms } from "@/lib/terms";
import { usePaged } from "@/lib/usePaged";
import { useSort } from "@/lib/useSort";
import { SortTh } from "@/components/SortTh";
import { Pager } from "@/components/Pager";
import { ListHeader, FilterChips } from "@/components/ListToolbar";
import { DateRangePicker } from "@/components/DateRangePicker";
import {
  PaymentMethodSelect,
  usePaymentMethods,
  type PaymentMethodOption,
} from "@/components/PaymentMethodPicker";
import { PaidStamp } from "@/components/PaidStamp";
import { methodLabel } from "@/lib/payments";
import type { DateRange } from "@/lib/dateRange";
import { ExpensesPanel } from "./ExpensesPanel";
import type { Bill, Expense, Store } from "@/lib/types";

const FILTERS = ["ALL", "OPEN", "OVERDUE", "PAID"] as const;
type Filter = (typeof FILTERS)[number];

// A vendor Bill and a due/payable operating Expense (most often posted from
// a recurring template — rent, insurance, a subscription) show in the same
// list so an open one of either kind is just as visible and payable.
type Row = { kind: "BILL"; id: string; bill: Bill } | { kind: "EXPENSE"; id: string; expense: Expense };

type RowSortKey =
  | "billNumber"
  | "vendor"
  | "po"
  | "store"
  | "billDate"
  | "terms"
  | "due"
  | "amount"
  | "paymentType"
  | "status";

// Sort fields that don't apply to one kind (e.g. a bill #, or a due date on
// an expense) resolve to null, which useSort always sorts last.
function rowValue(
  r: Row,
  key: RowSortKey,
  paymentMethods: PaymentMethodOption[],
): string | number | null {
  if (r.kind === "BILL") {
    const b = r.bill;
    switch (key) {
      case "billNumber":
        return b.billNumber || null;
      case "vendor":
        return b.vendor;
      case "po":
        return b.po?.poNumber ?? null;
      case "store":
        return b.store?.name ?? null;
      case "billDate":
        return new Date(b.billDate).getTime();
      case "terms":
        return b.terms || null;
      case "due":
        return b.dueDate ? new Date(b.dueDate).getTime() : null;
      case "amount":
        return b.subtotalCents;
      case "paymentType":
        return methodLabel(b.paymentMethod, paymentMethods);
      case "status":
        return b.status === "PAID" ? 1 : 0;
    }
  }
  const e = r.expense;
  switch (key) {
    case "billNumber":
      return null;
    case "vendor":
      return e.payee || e.category;
    case "po":
      return null;
    case "store":
      return e.store?.name ?? null;
    case "billDate":
      return new Date(e.expenseDate).getTime();
    case "terms":
      return null;
    case "due":
      return new Date(e.expenseDate).getTime();
    case "amount":
      return e.amountCents;
    case "paymentType":
      return methodLabel(e.paymentMethod, paymentMethods);
    case "status":
      return e.status === "PAID" ? 1 : 0;
  }
}

function matchesExpenseSearch(e: Expense, q: string): boolean {
  const needle = q.toLowerCase();
  return (
    e.category.toLowerCase().includes(needle) ||
    e.payee.toLowerCase().includes(needle) ||
    e.memo.toLowerCase().includes(needle) ||
    formatMoney(e.amountCents).toLowerCase().includes(needle)
  );
}

function fmtDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString() : "—";
}
function daysFromNow(s: string | null) {
  if (!s) return null;
  return Math.round((new Date(s).getTime() - Date.now()) / 86_400_000);
}

// Net terms set the due date from the bill date; "— None —"/Custom leave it
// to be typed. Returns "" (don't touch dueDate) when terms don't imply one.
function dueDateForBillTerms(terms: string, billDate: string): string {
  if (!billDate) return "";
  const [y, m, day] = billDate.split("-").map(Number);
  const d = dueDateFromTerms(new Date(y, (m || 1) - 1, day || 1), terms);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function BillsView({
  canManage,
  isAdmin = false,
}: {
  canManage: boolean;
  isAdmin?: boolean;
}) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openExpenseId, setOpenExpenseId] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState(""); // "" = all stores (admin only)
  // null = no date filter (every bill, the long-standing default) — set once
  // the picker below is touched.
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [dateLabel, setDateLabel] = useState("");
  const [paymentMethods] = usePaymentMethods();

  useEffect(() => {
    if (!isAdmin) return;
    api<{ stores: Store[] }>("/api/stores")
      .then((r) => setStores(r.stores))
      .catch(() => {});
  }, [isAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const billParams = new URLSearchParams();
      if (filter === "OVERDUE") billParams.set("overdue", "1");
      else if (filter !== "ALL") billParams.set("status", filter);
      if (q.trim()) billParams.set("q", q.trim());
      if (isAdmin && storeId) billParams.set("storeId", storeId);
      if (dateRange) {
        billParams.set("from", dateRange.from.toISOString());
        billParams.set("to", dateRange.to.toISOString());
      }

      // Expenses don't have a due date distinct from when they're logged, so
      // there's no "overdue" notion for them — that tab shows bills only.
      const expenseParams = new URLSearchParams();
      if (filter === "OPEN") expenseParams.set("status", "UNPAID");
      else if (filter === "PAID") expenseParams.set("status", "PAID");
      if (isAdmin && storeId) expenseParams.set("storeId", storeId);
      if (dateRange) {
        expenseParams.set("from", dateRange.from.toISOString());
        expenseParams.set("to", dateRange.to.toISOString());
      }

      const [billsRes, expensesRes] = await Promise.all([
        api<{ bills: Bill[] }>(`/api/bills?${billParams.toString()}`),
        filter === "OVERDUE"
          ? Promise.resolve({ expenses: [] as Expense[] })
          : api<{ expenses: Expense[] }>(`/api/expenses?${expenseParams.toString()}`),
      ]);
      setBills(billsRes.bills);
      const q2 = q.trim();
      setExpenses(q2 ? expensesRes.expenses.filter((e) => matchesExpenseSearch(e, q2)) : expensesRes.expenses);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load bills");
    } finally {
      setLoading(false);
    }
  }, [filter, q, isAdmin, storeId, dateRange]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  // Recurring bills (rent, insurance, subscriptions…) auto-post as soon as
  // they're due — right when the Bills page opens, so they show up as open
  // items below with no manual "Post" step first.
  useEffect(() => {
    api("/api/recurring-expenses/run", { method: "POST", body: "{}" })
      .catch(() => {})
      .finally(() => load());
    // Intentionally once per mount — not tied to `load`'s own identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep link from a related record (e.g. a purchase order's "Bills" line):
  // /bills?open=<id> opens that bill straight away.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) {
      setOpenId(id);
      window.history.replaceState(null, "", "/bills");
    }
  }, []);

  const totalOpen = useMemo(
    () =>
      bills.filter((b) => b.status === "OPEN").reduce((s, b) => s + b.subtotalCents, 0) +
      expenses.filter((e) => e.status === "UNPAID").reduce((s, e) => s + e.amountCents, 0),
    [bills, expenses],
  );
  const openCount =
    bills.filter((b) => b.status === "OPEN").length + expenses.filter((e) => e.status === "UNPAID").length;

  const rows: Row[] = useMemo(
    () => [
      ...bills.map((bill) => ({ kind: "BILL" as const, id: bill.id, bill })),
      ...expenses.map((expense) => ({ kind: "EXPENSE" as const, id: expense.id, expense })),
    ],
    [bills, expenses],
  );

  // Unpaid first, soonest due first, until a column header is clicked.
  const defaultSort = useCallback(
    (a: Row, b: Row) => {
      const aPaid = rowValue(a, "status", paymentMethods) as number;
      const bPaid = rowValue(b, "status", paymentMethods) as number;
      if (aPaid !== bPaid) return aPaid - bPaid;
      const ad = rowValue(a, "due", paymentMethods) as number | null;
      const bd = rowValue(b, "due", paymentMethods) as number | null;
      if (ad == null && bd == null) return 0;
      if (ad == null) return 1;
      if (bd == null) return -1;
      return ad - bd;
    },
    [paymentMethods],
  );

  const { sorted, sortKey, sortDir, sortBy } = useSort<Row, RowSortKey>(
    rows,
    (r, key) => rowValue(r, key, paymentMethods),
    defaultSort,
  );

  const pg = usePaged(sorted);

  return (
    <div className="w-full flex-1 p-4">
      <ListHeader title="Bills">
        <span className="text-sm text-zinc-400">
          {openCount} open · {formatMoney(totalOpen)} payable
        </span>
        <input
          className="input max-w-md"
          placeholder="Search bill #, vendor, PO, item, SKU, memo, amount…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q && (
          <button onClick={() => setQ("")} className="btn-ghost text-xs">
            Clear
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {isAdmin && (
            <select
              className="input mr-1 h-8 w-auto min-w-44 text-sm"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              <option value="">All stores (combined)</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <FilterChips
            options={FILTERS.map((f) => ({ key: f, label: f[0] + f.slice(1).toLowerCase() }))}
            value={filter}
            onChange={setFilter}
          />
          <DateRangePicker
            defaultPreset="all"
            allowAll
            onChange={(r, l) => {
              setDateRange(r);
              setDateLabel(l);
            }}
            onClear={() => {
              setDateRange(null);
              setDateLabel("");
            }}
          />
        </div>
      </ListHeader>

      <p className="mb-3 text-xs text-zinc-400">
        {rows.length} shown{dateRange ? ` · showing ${dateLabel.toLowerCase()}` : ""} · Bills are
        created when you receive items on a purchase order; recurring bills (rent, insurance,
        subscriptions…) show here as open the moment they&rsquo;re due.
      </p>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <Pager {...pg} className="mb-2 justify-end" />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <SortTh sortKey="billNumber" activeKey={sortKey} dir={sortDir} onSort={sortBy} className="px-4 py-2.5">
                Bill #
              </SortTh>
              <SortTh sortKey="vendor" activeKey={sortKey} dir={sortDir} onSort={sortBy} className="px-4 py-2.5">
                Vendor
              </SortTh>
              <SortTh sortKey="po" activeKey={sortKey} dir={sortDir} onSort={sortBy} className="px-4 py-2.5">
                PO
              </SortTh>
              <SortTh sortKey="store" activeKey={sortKey} dir={sortDir} onSort={sortBy} className="px-4 py-2.5">
                Store
              </SortTh>
              <SortTh sortKey="billDate" activeKey={sortKey} dir={sortDir} onSort={sortBy} className="px-4 py-2.5">
                Bill date
              </SortTh>
              <SortTh sortKey="terms" activeKey={sortKey} dir={sortDir} onSort={sortBy} className="px-4 py-2.5">
                Terms
              </SortTh>
              <SortTh sortKey="due" activeKey={sortKey} dir={sortDir} onSort={sortBy} className="px-4 py-2.5">
                Due
              </SortTh>
              <SortTh
                sortKey="amount"
                activeKey={sortKey}
                dir={sortDir}
                onSort={sortBy}
                align="right"
                className="px-4 py-2.5 text-right"
              >
                Amount
              </SortTh>
              <SortTh sortKey="paymentType" activeKey={sortKey} dir={sortDir} onSort={sortBy} className="px-4 py-2.5">
                Payment type
              </SortTh>
              <SortTh sortKey="status" activeKey={sortKey} dir={sortDir} onSort={sortBy} className="px-4 py-2.5">
                Status
              </SortTh>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : pg.total === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-zinc-400">
                  No bills{filter === "ALL" ? "" : ` (${filter.toLowerCase()})`}.
                </td>
              </tr>
            ) : (
              pg.pageItems.map((r) => {
                if (r.kind === "BILL") {
                  const b = r.bill;
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
                      <td className="px-4 py-2.5 text-zinc-500">{formatDateOnly(b.billDate)}</td>
                      <td className="px-4 py-2.5 text-zinc-500">{b.terms || "—"}</td>
                      <td className={`px-4 py-2.5 ${overdue ? "font-medium text-red-600" : "text-zinc-500"}`}>
                        {formatDateOnly(b.dueDate)}
                        {b.status === "OPEN" && d !== null && (
                          <span className="ml-1 text-xs">
                            ({d < 0 ? `${-d}d late` : d === 0 ? "today" : `${d}d`})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        {formatMoney(b.subtotalCents)}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-500">
                        {methodLabel(b.paymentMethod, paymentMethods)}
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
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenId(b.id);
                          }}
                          className="btn-ghost text-xs text-indigo-600"
                        >
                          {canManage ? "Edit" : "View"}
                        </button>
                      </td>
                    </tr>
                  );
                }
                const ex = r.expense;
                return (
                  <tr
                    key={ex.id}
                    onClick={() => setOpenExpenseId(ex.id)}
                    className="cursor-pointer hover:bg-zinc-50"
                  >
                    <td className="px-4 py-2.5 text-zinc-400">—</td>
                    <td className="px-4 py-2.5">
                      {ex.payee || ex.category}
                      <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                        Expense
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400">—</td>
                    <td className="px-4 py-2.5 text-zinc-500">
                      {ex.store?.name.replace(/^Chef and Beyond - /, "") ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500">{formatDateOnly(ex.expenseDate)}</td>
                    <td className="px-4 py-2.5 text-zinc-400">—</td>
                    <td className="px-4 py-2.5 text-zinc-500">{formatDateOnly(ex.expenseDate)}</td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {formatMoney(ex.amountCents)}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500">
                      {methodLabel(ex.paymentMethod, paymentMethods)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          ex.status === "PAID"
                            ? "bg-green-100 text-green-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {ex.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenExpenseId(ex.id);
                        }}
                        className="btn-ghost text-xs text-indigo-600"
                      >
                        {canManage ? "Edit" : "View"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ExpensesPanel isAdmin={isAdmin} storeId={isAdmin ? storeId : ""} dateRange={dateRange} />

      {openId && (
        <BillDetailModal
          billId={openId}
          canManage={canManage}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}

      {openExpenseId &&
        (() => {
          const ex = expenses.find((e) => e.id === openExpenseId);
          if (!ex) return null;
          return (
            <ExpenseDetailModal
              expense={ex}
              canManage={canManage}
              onClose={() => setOpenExpenseId(null)}
              onChanged={load}
            />
          );
        })()}
    </div>
  );
}

function ExpenseDetailModal({
  expense,
  canManage,
  onClose,
  onChanged,
}: {
  expense: Expense;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [edit, setEdit] = useState({
    category: expense.category,
    payee: expense.payee,
    amountCents: expense.amountCents,
    expenseDate: expense.expenseDate.slice(0, 10),
    memo: expense.memo,
    paymentMethod: expense.paymentMethod,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = usePaymentMethods();

  async function patch(data: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/expenses/${expense.id}`, { method: "PATCH", body: JSON.stringify(data) });
      onChanged();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save");
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this expense?")) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/expenses/${expense.id}`, { method: "DELETE" });
      onChanged();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-6">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {canManage ? "Edit expense" : "Expense"}
            {expense.status === "PAID" && (
              <PaidStamp detail={methodLabel(expense.paymentMethod, paymentMethods)} />
            )}
          </h2>
          <button onClick={onClose} className="btn-ghost px-2 py-1 text-sm">
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-zinc-500">
          {expense.store?.name ?? "Company-wide"} · from {expense.createdBy?.name ?? "—"} on{" "}
          {formatDateOnly(expense.createdAt)}
        </p>

        {err && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Category</label>
            <input
              className="input"
              value={edit.category}
              disabled={!canManage}
              onChange={(e) => setEdit({ ...edit, category: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Payee</label>
            <input
              className="input"
              value={edit.payee}
              disabled={!canManage}
              onChange={(e) => setEdit({ ...edit, payee: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Amount</label>
            <MoneyInput
              cents={edit.amountCents}
              onCentsChange={(c) => setEdit({ ...edit, amountCents: c })}
              disabled={!canManage}
            />
          </div>
          <div>
            <label className="label">Date</label>
            <input
              type="date"
              className="input"
              value={edit.expenseDate}
              disabled={!canManage}
              onChange={(e) => setEdit({ ...edit, expenseDate: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Memo</label>
            <input
              className="input"
              value={edit.memo}
              disabled={!canManage}
              onChange={(e) => setEdit({ ...edit, memo: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Payment method</label>
            <PaymentMethodSelect
              value={edit.paymentMethod}
              onChange={(code) => setEdit({ ...edit, paymentMethod: code })}
              methods={paymentMethods}
              onAdded={(m) => setPaymentMethods((cur) => [...cur, m])}
              disabled={!canManage}
            />
          </div>
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                patch({
                  category: edit.category.trim(),
                  payee: edit.payee.trim(),
                  amountCents: edit.amountCents,
                  expenseDate: edit.expenseDate,
                  memo: edit.memo.trim(),
                  paymentMethod: edit.paymentMethod,
                })
              }
              disabled={busy}
              className="btn-secondary"
            >
              Save changes
            </button>
            {expense.status === "UNPAID" ? (
              <button
                onClick={() => patch({ status: "PAID", paymentMethod: edit.paymentMethod })}
                disabled={busy}
                className="btn-primary"
              >
                Mark paid
              </button>
            ) : (
              <button onClick={() => patch({ status: "UNPAID" })} disabled={busy} className="btn-secondary">
                Reopen
              </button>
            )}
            <button onClick={remove} disabled={busy} className="btn-ghost text-red-500">
              Delete
            </button>
          </div>
        )}
      </div>
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
  const [edit, setEdit] = useState({
    billNumber: "",
    vendor: "",
    terms: "",
    dueDate: "",
    billDate: "",
    paidAt: "",
    memo: "",
    paymentMethod: "USBANK_6118",
  });
  const [adj, setAdj] = useState<BillAdjustmentValues>({
    shippingCents: 0,
    minOrderFeeCents: 0,
    dropShipFeeCents: 0,
    earlyPayDiscountBps: 0,
    vendorCreditCents: 0,
  });
  const [paymentMethods, setPaymentMethods] = usePaymentMethods();
  // id -> { qty text, unit cost cents } for the line-item corrections.
  const [lineEdits, setLineEdits] = useState<
    Record<string, { quantity: string; unitCostCents: number }>
  >({});

  const load = useCallback(async () => {
    try {
      const res = await api<{ bill: Bill }>(`/api/bills/${billId}`);
      setBill(res.bill);
      setEdit({
        billNumber: res.bill.billNumber,
        vendor: res.bill.vendor,
        terms: res.bill.terms,
        dueDate: res.bill.dueDate ? res.bill.dueDate.slice(0, 10) : "",
        billDate: res.bill.billDate ? res.bill.billDate.slice(0, 10) : "",
        // The date that will be stamped when "Mark paid" is clicked, or —
        // once the bill is PAID — the date it was actually stamped, editable
        // to correct a bill migrated from another POS after the fact.
        paidAt: res.bill.paidAt ? res.bill.paidAt.slice(0, 10) : todayInputValue(),
        memo: res.bill.memo,
        paymentMethod: res.bill.paymentMethod || "USBANK_6118",
      });
      setAdj({
        shippingCents: res.bill.shippingCents ?? 0,
        minOrderFeeCents: res.bill.minOrderFeeCents ?? 0,
        dropShipFeeCents: res.bill.dropShipFeeCents ?? 0,
        earlyPayDiscountBps: res.bill.earlyPayDiscountBps ?? 0,
        vendorCreditCents: res.bill.vendorCreditCents ?? 0,
      });
      setLineEdits(
        Object.fromEntries(
          (res.bill.items ?? []).map((it) => [
            it.id,
            { quantity: String(it.quantity), unitCostCents: it.unitCostCents },
          ]),
        ),
      );
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
      onChanged();
      onClose();
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

  // Live totals from the (possibly edited) lines and fee inputs. "Other" is the
  // legacy PO tax / logged-cost portion baked into the saved total.
  const itemsCents = (bill?.items ?? []).reduce((s, it) => {
    const le = lineEdits[it.id];
    const qty = le ? parseInt(le.quantity, 10) || 0 : it.quantity;
    const unit = le ? le.unitCostCents : it.unitCostCents;
    return s + qty * unit;
  }, 0);
  const savedItemsCents = (bill?.items ?? []).reduce((s, it) => s + it.lineCostCents, 0);
  const otherCents = bill
    ? bill.subtotalCents -
      savedItemsCents -
      (bill.shippingCents + bill.minOrderFeeCents + bill.dropShipFeeCents) +
      earlyPayDiscountCents(savedItemsCents, bill.earlyPayDiscountBps) +
      bill.vendorCreditCents
    : 0;
  const feesCents = adj.shippingCents + adj.minOrderFeeCents + adj.dropShipFeeCents;
  const discountCents = earlyPayDiscountCents(itemsCents, adj.earlyPayDiscountBps);
  const totalCents = itemsCents + otherCents + feesCents - discountCents - adj.vendorCreditCents;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
        {!bill ? (
          <p className="text-sm text-zinc-500">{err ?? "Loading…"}</p>
        ) : (
          <>
            <div className="mb-1 flex items-center justify-between gap-3">
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                {canManage ? "Edit bill" : "Bill"}{" "}
                {bill.billNumber ? `#${bill.billNumber}` : ""} · {bill.vendor}
                {bill.status === "PAID" && (
                  <PaidStamp
                    detail={
                      methodLabel(bill.paymentMethod, paymentMethods) +
                      (bill.paidAt ? ` · paid ${fmtDate(bill.paidAt)}` : "")
                    }
                  />
                )}
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

            <div className="mb-4 grid gap-3 sm:grid-cols-3">
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
                <label className="label">Vendor</label>
                <VendorPicker
                  value={edit.vendor}
                  disabled={!canManage}
                  onChange={(name) => setEdit((s) => ({ ...s, vendor: name }))}
                />
              </div>
              <div>
                <label className="label">Bill date</label>
                <input
                  type="date"
                  className="input"
                  value={edit.billDate}
                  disabled={!canManage}
                  onChange={(e) => {
                    const billDate = e.target.value;
                    const due = dueDateForBillTerms(edit.terms, billDate);
                    setEdit((s) => ({ ...s, billDate, ...(due ? { dueDate: due } : {}) }));
                  }}
                />
              </div>
              <div>
                <label className="label">Terms</label>
                <select
                  className="input"
                  value={edit.terms}
                  disabled={!canManage}
                  onChange={(e) => {
                    const terms = e.target.value;
                    const due = dueDateForBillTerms(terms, edit.billDate);
                    setEdit((s) => ({ ...s, terms, ...(due ? { dueDate: due } : {}) }));
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
                  value={edit.dueDate}
                  disabled={!canManage}
                  onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Payment method</label>
                <PaymentMethodSelect
                  value={edit.paymentMethod}
                  onChange={(code) => setEdit({ ...edit, paymentMethod: code })}
                  methods={paymentMethods}
                  onAdded={(m) => setPaymentMethods((cur) => [...cur, m])}
                  disabled={!canManage}
                  className={`input ${canManage ? "" : "bg-zinc-50 text-zinc-400"}`}
                />
              </div>
              <div>
                <label className="label">Paid date</label>
                <input
                  type="date"
                  className="input"
                  value={edit.paidAt}
                  disabled={!canManage}
                  onChange={(e) => setEdit({ ...edit, paidAt: e.target.value })}
                />
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  {bill.status === "PAID"
                    ? "When this bill was actually paid — edit and Save changes to correct it."
                    : "Used when you click Mark paid — back-date it for a bill entered after the fact."}
                </p>
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
                  {(bill.items ?? []).map((it) => {
                    const le = lineEdits[it.id] ?? {
                      quantity: String(it.quantity),
                      unitCostCents: it.unitCostCents,
                    };
                    const qty = parseInt(le.quantity, 10) || 0;
                    const amount = qty * le.unitCostCents;
                    return (
                      <tr key={it.id}>
                        <td className="py-2">
                          {it.nameSnapshot}
                          <span className="ml-1 text-xs text-zinc-400">{it.skuSnapshot}</span>
                        </td>
                        <td className="py-2 text-right">
                          {canManage ? (
                            <input
                              className="input h-8 w-16 text-right tabular-nums"
                              inputMode="numeric"
                              value={le.quantity}
                              onChange={(e) =>
                                setLineEdits((cur) => ({
                                  ...cur,
                                  [it.id]: {
                                    ...le,
                                    quantity: e.target.value.replace(/[^0-9-]/g, ""),
                                  },
                                }))
                              }
                            />
                          ) : (
                            <span className="tabular-nums">{it.quantity}</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {canManage ? (
                            <MoneyInput
                              cents={le.unitCostCents}
                              onCentsChange={(c) =>
                                setLineEdits((cur) => ({
                                  ...cur,
                                  [it.id]: { ...le, unitCostCents: c },
                                }))
                              }
                              className="input h-8 w-24 text-right"
                            />
                          ) : (
                            formatMoney(it.unitCostCents)
                          )}
                        </td>
                        <td className="py-2 text-right font-medium tabular-nums">
                          {formatMoney(amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="pt-2 text-right text-zinc-500">
                      Items
                    </td>
                    <td className="pt-2 text-right tabular-nums text-zinc-500">
                      {formatMoney(itemsCents)}
                    </td>
                  </tr>
                  {otherCents !== 0 && (
                    <tr>
                      <td colSpan={3} className="py-1 text-right text-zinc-500">
                        Tax &amp; other logged costs
                      </td>
                      <td className="py-1 text-right tabular-nums text-zinc-500">
                        {formatMoney(otherCents)}
                      </td>
                    </tr>
                  )}
                  {feesCents > 0 && (
                    <tr>
                      <td colSpan={3} className="py-1 text-right text-zinc-500">
                        Shipping &amp; fees
                      </td>
                      <td className="py-1 text-right tabular-nums text-zinc-500">
                        {formatMoney(feesCents)}
                      </td>
                    </tr>
                  )}
                  {discountCents > 0 && (
                    <tr>
                      <td colSpan={3} className="py-1 text-right text-zinc-500">
                        Early-pay discount ({adj.earlyPayDiscountBps / 100}%)
                      </td>
                      <td className="py-1 text-right tabular-nums text-green-700">
                        -{formatMoney(discountCents)}
                      </td>
                    </tr>
                  )}
                  {adj.vendorCreditCents > 0 && (
                    <tr>
                      <td colSpan={3} className="py-1 text-right text-zinc-500">
                        Vendor credit
                      </td>
                      <td className="py-1 text-right tabular-nums text-green-700">
                        -{formatMoney(adj.vendorCreditCents)}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={3} className="py-2 text-right font-medium">
                      Total
                    </td>
                    <td className="py-2 text-right text-base font-bold tabular-nums">
                      {formatMoney(totalCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {canManage && (
              <p className="mt-1 text-[11px] text-zinc-400">
                Changing a quantity also adjusts this store&rsquo;s stock and the linked
                purchase order&rsquo;s received amount. Unit-cost edits change the bill only.
              </p>
            )}

            <BillAdjustments
              values={adj}
              onChange={setAdj}
              itemsCents={itemsCents}
              disabled={!canManage}
            />

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
                      vendor: edit.vendor.trim() || bill.vendor,
                      terms: edit.terms,
                      billDate: edit.billDate || undefined,
                      dueDate: edit.dueDate || null,
                      // Only takes effect while the bill is already PAID —
                      // it's how a wrong paid date gets corrected.
                      ...(bill.status === "PAID" ? { paidAt: edit.paidAt || undefined } : {}),
                      memo: edit.memo.trim(),
                      paymentMethod: edit.paymentMethod,
                      ...adj,
                      lines: (bill.items ?? []).map((it) => {
                        const le = lineEdits[it.id];
                        return {
                          id: it.id,
                          quantity: le ? parseInt(le.quantity, 10) || 0 : it.quantity,
                          unitCostCents: le ? le.unitCostCents : it.unitCostCents,
                        };
                      }),
                    })
                  }
                  disabled={busy}
                  className="btn-secondary"
                >
                  Save changes
                </button>
                {bill.status === "OPEN" ? (
                  <button
                    onClick={() =>
                      patch({
                        status: "PAID",
                        paymentMethod: edit.paymentMethod,
                        paidAt: edit.paidAt || undefined,
                      })
                    }
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
