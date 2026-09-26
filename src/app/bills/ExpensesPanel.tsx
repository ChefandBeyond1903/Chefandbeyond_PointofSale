"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";
import { MoneyInput } from "@/components/MoneyInput";
import { RECUR_FREQUENCY_LABEL } from "@/lib/recur";
import { methodLabel } from "@/lib/payments";
import { PaymentMethodSelect, usePaymentMethods } from "@/components/PaymentMethodPicker";
import type { DateRange } from "@/lib/dateRange";
import type { Expense, RecurringExpense, Store } from "@/lib/types";

const FREQUENCIES = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;

function todayInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function fmtDate(s: string) {
  // Expense dates are whole calendar days — read them in UTC so a date picked
  // as 9/1 doesn't display as 8/31 west of UTC.
  return new Date(s).toLocaleDateString(undefined, { timeZone: "UTC" });
}

export function ExpensesPanel({
  isAdmin,
  storeId = "",
  dateRange = null,
}: {
  isAdmin: boolean;
  // The store selected in the Bills store filter above ("" = all stores) —
  // keeps this list in step with that same selection.
  storeId?: string;
  // The date range picked in the Bills header above (null = no filter) —
  // keeps this list in step with that same selection.
  dateRange?: DateRange | null;
}) {
  const [rows, setRows] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  type EditForm = {
    id: string;
    category: string;
    payee: string;
    amountCents: number;
    expenseDate: string;
    memo: string;
    status: "PAID" | "UNPAID";
    paymentMethod: string;
    storeId: string;
  };
  const [edit, setEdit] = useState<EditForm | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const [paymentMethods, setPaymentMethods] = usePaymentMethods();

  const [form, setForm] = useState({
    category: "",
    payee: "",
    amountCents: 0,
    // Filled on mount (client-local date) — computing it during render would
    // mismatch the server's UTC date and break hydration on this page.
    expenseDate: "",
    memo: "",
    status: "PAID" as "PAID" | "UNPAID",
    paymentMethod: "CASH",
    storeId: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      if (dateRange) {
        params.set("from", dateRange.from.toISOString());
        params.set("to", dateRange.to.toISOString());
      }
      const qs = params.toString() ? `?${params.toString()}` : "";
      const [e, c] = await Promise.all([
        api<{ expenses: Expense[] }>(`/api/expenses${qs}`),
        api<{ categories: string[] }>("/api/expense-categories"),
      ]);
      setRows(e.expenses);
      setCategories(c.categories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load expenses");
    } finally {
      setLoading(false);
    }
  }, [storeId, dateRange]);

  useEffect(() => {
    setForm((f) => (f.expenseDate ? f : { ...f, expenseDate: todayInput() }));
    load();
    if (isAdmin) {
      api<{ stores: Store[] }>("/api/stores?all=1")
        .then((r) => setStores(r.stores))
        .catch(() => {});
    }
  }, [load, isAdmin]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.amountCents, 0), [rows]);

  // One row per category, A–Z, each holding its bills newest-first and a
  // running total — the source of truth for both the category subtotal and
  // the grand total below, so nothing here is ever a hardcoded figure.
  const groupedByCategory = useMemo(() => {
    const byCategory = new Map<string, Expense[]>();
    for (const r of rows) {
      const list = byCategory.get(r.category) ?? [];
      list.push(r);
      byCategory.set(r.category, list);
    }
    return [...byCategory.entries()]
      .map(([category, items]) => ({
        category,
        items: [...items].sort(
          (a, b) => new Date(b.expenseDate).getTime() - new Date(a.expenseDate).getTime(),
        ),
        totalCents: items.reduce((s, r) => s + r.amountCents, 0),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [rows]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggleExpanded(category: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  // Persists a category typed into any of the pickers below so it's in the
  // dropdown/datalist from then on — a no-op (upsert) if it already exists.
  async function ensureCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return;
    try {
      const r = await api<{ categories: string[] }>("/api/expense-categories", {
        method: "POST",
        body: JSON.stringify({ name: trimmed }),
      });
      setCategories(r.categories);
    } catch {
      /* non-fatal — the expense/template still saves with this category text */
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.category.trim()) {
      setError("Enter a category");
      return;
    }
    if (form.amountCents <= 0) {
      setError("Enter an amount");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ensureCategory(form.category);
      await api("/api/expenses", {
        method: "POST",
        body: JSON.stringify({
          category: form.category.trim(),
          payee: form.payee.trim(),
          amountCents: form.amountCents,
          expenseDate: form.expenseDate,
          memo: form.memo.trim(),
          status: form.status,
          paymentMethod: form.paymentMethod,
          ...(isAdmin && form.storeId ? { storeId: form.storeId } : {}),
        }),
      });
      setForm({
        category: "",
        payee: "",
        amountCents: 0,
        expenseDate: todayInput(),
        memo: "",
        status: "PAID",
        paymentMethod: "CASH",
        storeId: "",
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the expense");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this expense?")) return;
    try {
      await api(`/api/expenses/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the expense");
    }
  }

  function startEdit(r: Expense) {
    setError(null);
    setEdit({
      id: r.id,
      category: r.category,
      payee: r.payee,
      amountCents: r.amountCents,
      expenseDate: r.expenseDate ? r.expenseDate.slice(0, 10) : todayInput(),
      memo: r.memo,
      status: r.status,
      paymentMethod: r.paymentMethod || "CASH",
      storeId: r.storeId ?? "",
    });
  }

  async function saveEdit() {
    if (!edit) return;
    if (!edit.category.trim()) return setError("Enter a category");
    if (edit.amountCents <= 0) return setError("Enter an amount");
    setEditBusy(true);
    setError(null);
    try {
      await ensureCategory(edit.category);
      await api(`/api/expenses/${edit.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          category: edit.category.trim(),
          payee: edit.payee.trim(),
          amountCents: edit.amountCents,
          expenseDate: edit.expenseDate,
          memo: edit.memo.trim(),
          status: edit.status,
          paymentMethod: edit.paymentMethod,
          ...(isAdmin ? { storeId: edit.storeId || null } : {}),
        }),
      });
      setEdit(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the expense");
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <div className="mt-10">
      {/* Shared by every category input on this page (here, the edit modal,
          and the recurring-expense form) — type a new name and it's saved
          automatically, so it's offered here next time. */}
      <datalist id="expense-category-options">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Operating expenses</h2>
        <span className="text-sm text-zinc-400">
          {rows.length} shown · {formatMoney(total)} total
        </span>
      </div>
      <p className="mb-3 text-xs text-zinc-400">
        Rent, utilities (water, internet, gas, electric…), insurance and other running
        costs. These feed the Profit &amp; Loss statement under Reports.
      </p>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form onSubmit={submit} className="card mb-4 grid gap-3 p-4 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="label">Category</label>
          <input
            className="input"
            list="expense-category-options"
            placeholder="Type or pick a category"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Payee (optional)</label>
          <input
            className="input"
            placeholder="e.g. City Water Dept."
            value={form.payee}
            onChange={(e) => setForm({ ...form, payee: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Amount</label>
          <MoneyInput
            cents={form.amountCents}
            onCentsChange={(c) => setForm({ ...form, amountCents: c })}
          />
        </div>
        <div>
          <label className="label">Date</label>
          <input
            type="date"
            className="input"
            value={form.expenseDate}
            onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
          />
        </div>
        <div className={isAdmin ? "sm:col-span-3" : "sm:col-span-4"}>
          <label className="label">Memo (optional)</label>
          <input
            className="input"
            value={form.memo}
            onChange={(e) => setForm({ ...form, memo: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Status</label>
          <select
            className="input"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as "PAID" | "UNPAID" })}
          >
            <option value="PAID">Paid</option>
            <option value="UNPAID">Unpaid</option>
          </select>
        </div>
        <div>
          <label className="label">Payment method</label>
          <PaymentMethodSelect
            value={form.paymentMethod}
            onChange={(code) => setForm({ ...form, paymentMethod: code })}
            methods={paymentMethods}
            onAdded={(m) => setPaymentMethods((cur) => [...cur, m])}
          />
        </div>
        {isAdmin && (
          <div>
            <label className="label">Store</label>
            <select
              className="input"
              value={form.storeId}
              onChange={(e) => setForm({ ...form, storeId: e.target.value })}
            >
              <option value="">Company-wide</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-end">
          <button className="btn-primary w-full whitespace-nowrap" disabled={busy}>
            {busy ? "Saving…" : "Add expense"}
          </button>
        </div>
      </form>

      <div className="card overflow-x-auto">
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-400">No expenses recorded yet.</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <tbody className="divide-y divide-zinc-100">
              {groupedByCategory.map(({ category, items, totalCents }) => {
                const isOpen = expanded.has(category);
                return (
                  <Fragment key={category}>
                    <tr
                      onClick={() => toggleExpanded(category)}
                      className="cursor-pointer bg-zinc-50 hover:bg-zinc-100"
                    >
                      <td className="px-4 py-2.5 font-medium" colSpan={6}>
                        <span className="mr-2 inline-block w-3 text-zinc-400">
                          {isOpen ? "▾" : "▸"}
                        </span>
                        {category}
                        <span className="ml-2 text-xs font-normal text-zinc-400">
                          {items.length} bill{items.length === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">
                        {formatMoney(totalCents)}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} className="bg-white p-0">
                          <table className="w-full text-sm">
                            <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
                              <tr>
                                <th className="px-4 py-2 pl-10">Date paid</th>
                                <th className="px-4 py-2">Vendor</th>
                                <th className="px-4 py-2">Notes</th>
                                <th className="px-4 py-2">Store</th>
                                <th className="px-4 py-2">Payment</th>
                                <th className="px-4 py-2 text-right">Amount</th>
                                <th className="px-4 py-2">Status</th>
                                <th className="px-4 py-2"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                              {items.map((r) => (
                                <tr key={r.id}>
                                  <td className="px-4 py-2 pl-10 text-zinc-500">
                                    {fmtDate(r.expenseDate)}
                                  </td>
                                  <td className="px-4 py-2 text-zinc-700">{r.payee || "—"}</td>
                                  <td className="px-4 py-2 text-zinc-500">{r.memo || "—"}</td>
                                  <td className="px-4 py-2 text-zinc-500">
                                    {r.store?.name.replace(/^Chef and Beyond - /, "") ??
                                      "Company-wide"}
                                  </td>
                                  <td className="px-4 py-2 text-zinc-500">
                                    {methodLabel(r.paymentMethod, paymentMethods)}
                                  </td>
                                  <td className="px-4 py-2 text-right font-medium">
                                    {formatMoney(r.amountCents)}
                                  </td>
                                  <td className="px-4 py-2">
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                        r.status === "PAID"
                                          ? "bg-green-100 text-green-700"
                                          : "bg-amber-100 text-amber-700"
                                      }`}
                                    >
                                      {r.status}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 text-right whitespace-nowrap">
                                    <button
                                      onClick={() => startEdit(r)}
                                      className="btn-ghost px-2 py-0.5 text-xs text-indigo-600"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => remove(r.id)}
                                      className="btn-ghost px-2 py-0.5 text-xs text-red-500"
                                    >
                                      Delete
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-200">
                <td className="px-4 py-3 font-semibold" colSpan={6}>
                  Grand total
                </td>
                <td className="px-4 py-3 text-right text-base font-bold">{formatMoney(total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <RecurringExpensesSection
        isAdmin={isAdmin}
        ensureCategory={ensureCategory}
        stores={stores}
        onPosted={load}
      />

      {edit && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setEdit(null)}
        >
          <div
            className="card max-h-[90vh] w-full max-w-md overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold">Edit expense</h2>
            {error && (
              <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            <div className="grid gap-3">
              <div>
                <label className="label">Category</label>
                <input
                  className="input"
                  list="expense-category-options"
                  placeholder="Type or pick a category"
                  value={edit.category}
                  onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Amount</label>
                  <MoneyInput
                    cents={edit.amountCents}
                    onCentsChange={(c) => setEdit({ ...edit, amountCents: c })}
                  />
                </div>
                <div>
                  <label className="label">Date</label>
                  <input
                    type="date"
                    className="input"
                    value={edit.expenseDate}
                    onChange={(e) => setEdit({ ...edit, expenseDate: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label">Payee</label>
                <input
                  className="input"
                  value={edit.payee}
                  onChange={(e) => setEdit({ ...edit, payee: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Memo</label>
                <input
                  className="input"
                  value={edit.memo}
                  onChange={(e) => setEdit({ ...edit, memo: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Status</label>
                  <select
                    className="input"
                    value={edit.status}
                    onChange={(e) =>
                      setEdit({ ...edit, status: e.target.value as "PAID" | "UNPAID" })
                    }
                  >
                    <option value="PAID">Paid</option>
                    <option value="UNPAID">Unpaid</option>
                  </select>
                </div>
                {isAdmin && (
                  <div>
                    <label className="label">Store</label>
                    <select
                      className="input"
                      value={edit.storeId}
                      onChange={(e) => setEdit({ ...edit, storeId: e.target.value })}
                    >
                      <option value="">Company-wide</option>
                      {stores.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="label">Payment method</label>
                  <PaymentMethodSelect
                    value={edit.paymentMethod}
                    onChange={(code) => setEdit({ ...edit, paymentMethod: code })}
                    methods={paymentMethods}
                    onAdded={(m) => setPaymentMethods((cur) => [...cur, m])}
                  />
                </div>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setEdit(null)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={editBusy} className="btn-primary flex-1">
                {editBusy ? "Saving…" : "Save expense"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------- Recurring expenses ----------------------- */

function recurTodayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

type RecurForm = {
  category: string;
  payee: string;
  amountCents: number;
  memo: string;
  status: "PAID" | "UNPAID";
  paymentMethod: string;
  frequency: (typeof FREQUENCIES)[number];
  nextDate: string;
  storeId: string;
};

const emptyRecurForm = (): RecurForm => ({
  category: "",
  payee: "",
  amountCents: 0,
  memo: "",
  status: "PAID",
  paymentMethod: "CASH",
  frequency: "MONTHLY",
  nextDate: recurTodayISO(),
  storeId: "",
});

function RecurringExpensesSection({
  isAdmin,
  ensureCategory,
  stores,
  onPosted,
}: {
  isAdmin: boolean;
  // Persists a newly-typed category so it's in the shared datalist (see
  // #expense-category-options in ExpensesPanel) from then on.
  ensureCategory: (name: string) => Promise<void>;
  stores: Store[];
  onPosted: () => void;
}) {
  const [rows, setRows] = useState<RecurringExpense[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RecurForm>(emptyRecurForm);
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = usePaymentMethods();

  const load = useCallback(async () => {
    try {
      const r = await api<{ recurring: RecurringExpense[]; dueCount: number }>(
        "/api/recurring-expenses",
      );
      setRows(r.recurring);
      setDueCount(r.dueCount);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.category.trim()) return setErr("Enter a category");
    if (form.amountCents <= 0) return setErr("Enter an amount");
    setBusy(true);
    setErr(null);
    try {
      await ensureCategory(form.category);
      await api("/api/recurring-expenses", {
        method: "POST",
        body: JSON.stringify({
          category: form.category.trim(),
          payee: form.payee.trim(),
          amountCents: form.amountCents,
          memo: form.memo.trim(),
          status: form.status,
          paymentMethod: form.paymentMethod,
          frequency: form.frequency,
          nextDate: form.nextDate,
          ...(isAdmin && form.storeId ? { storeId: form.storeId } : {}),
        }),
      });
      setForm(emptyRecurForm());
      setOpen(false);
      load();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(r: RecurringExpense) {
    try {
      await api(`/api/recurring-expenses/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !r.active }),
      });
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not update");
    }
  }

  async function remove(r: RecurringExpense) {
    if (!confirm(`Stop the recurring "${r.category}" expense? Posted ones stay.`)) return;
    try {
      await api(`/api/recurring-expenses/${r.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete");
    }
  }

  async function postDue() {
    setPosting(true);
    setErr(null);
    try {
      const r = await api<{ posted: number }>("/api/recurring-expenses/run", { method: "POST" });
      await load();
      onPosted();
      if (r.posted === 0) setErr("Nothing was due.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not post");
    } finally {
      setPosting(false);
    }
  }

  const isDue = (r: RecurringExpense) =>
    r.active && new Date(r.nextDate).getTime() <= Date.now();

  // Normalizes every active template to a monthly-equivalent amount so mixed
  // frequencies (weekly, quarterly, yearly…) roll up into one comparable
  // "what will this cost me per month" figure.
  const monthlyEquivalentCents = (r: RecurringExpense) => {
    switch (r.frequency) {
      case "WEEKLY":
        return (r.amountCents * 52) / 12;
      case "QUARTERLY":
        return r.amountCents / 3;
      case "YEARLY":
        return r.amountCents / 12;
      default:
        return r.amountCents;
    }
  };
  const monthlyTotalCents = Math.round(
    rows.filter((r) => r.active).reduce((s, r) => s + monthlyEquivalentCents(r), 0),
  );

  return (
    <div className="card mb-4 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">Recurring expenses</h3>
        <span className="text-xs text-zinc-400">
          {rows.length} template{rows.length === 1 ? "" : "s"}
        </span>
        {rows.some((r) => r.active) && (
          <span className="text-xs font-medium text-zinc-600">
            ≈ {formatMoney(monthlyTotalCents)}/mo
          </span>
        )}
        {dueCount > 0 && (
          <button onClick={postDue} disabled={posting} className="btn-primary ml-auto h-8 text-xs">
            {posting ? "Posting…" : `Post ${dueCount} due`}
          </button>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          className={`btn-secondary h-8 text-xs ${dueCount > 0 ? "" : "ml-auto"}`}
        >
          {open ? "Cancel" : "+ New recurring"}
        </button>
      </div>

      {err && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

      {open && (
        <form
          onSubmit={add}
          className="mb-3 grid gap-2 rounded-md border border-zinc-200 p-3 sm:grid-cols-6"
        >
          <div className="sm:col-span-2">
            <label className="label">Category</label>
            <input
              className="input"
              list="expense-category-options"
              placeholder="Type or pick a category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Payee (optional)</label>
            <input
              className="input"
              value={form.payee}
              onChange={(e) => setForm({ ...form, payee: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Amount</label>
            <MoneyInput
              cents={form.amountCents}
              onCentsChange={(c) => setForm({ ...form, amountCents: c })}
            />
          </div>
          <div>
            <label className="label">Repeats</label>
            <select
              className="input"
              value={form.frequency}
              onChange={(e) =>
                setForm({ ...form, frequency: e.target.value as RecurForm["frequency"] })
              }
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {RECUR_FREQUENCY_LABEL[f]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Starting</label>
            <input
              type="date"
              className="input"
              value={form.nextDate}
              onChange={(e) => setForm({ ...form, nextDate: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as "PAID" | "UNPAID" })}
            >
              <option value="PAID">Paid</option>
              <option value="UNPAID">Unpaid</option>
            </select>
          </div>
          <div>
            <label className="label">Payment method</label>
            <PaymentMethodSelect
              value={form.paymentMethod}
              onChange={(code) => setForm({ ...form, paymentMethod: code })}
              methods={paymentMethods}
              onAdded={(m) => setPaymentMethods((cur) => [...cur, m])}
            />
          </div>
          <div className={isAdmin ? "sm:col-span-2" : "sm:col-span-3"}>
            <label className="label">Memo (optional)</label>
            <input
              className="input"
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
            />
          </div>
          {isAdmin && (
            <div>
              <label className="label">Store</label>
              <select
                className="input"
                value={form.storeId}
                onChange={(e) => setForm({ ...form, storeId: e.target.value })}
              >
                <option value="">Company-wide</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-end">
            <button className="btn-primary w-full whitespace-nowrap" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
              <tr>
                <th className="py-1.5">Category</th>
                <th className="py-1.5">Payee</th>
                <th className="py-1.5">Repeats</th>
                <th className="py-1.5">Payment</th>
                <th className="py-1.5">Next</th>
                <th className="py-1.5 text-right">Amount</th>
                <th className="py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r) => (
                <tr key={r.id} className={r.active ? "" : "opacity-50"}>
                  <td className="py-2 font-medium">{r.category}</td>
                  <td className="py-2 text-zinc-500">{r.payee || "—"}</td>
                  <td className="py-2 text-zinc-500">{RECUR_FREQUENCY_LABEL[r.frequency]}</td>
                  <td className="py-2 text-zinc-500">{methodLabel(r.paymentMethod, paymentMethods)}</td>
                  <td
                    className={`py-2 ${isDue(r) ? "font-medium text-amber-700" : "text-zinc-500"}`}
                  >
                    {formatDateOnly(r.nextDate)}
                    {isDue(r) && " · due"}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(r.amountCents)}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button onClick={() => toggleActive(r)} className="btn-ghost text-xs">
                      {r.active ? "Pause" : "Resume"}
                    </button>
                    <button
                      onClick={() => remove(r)}
                      className="btn-ghost text-xs text-red-500"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
