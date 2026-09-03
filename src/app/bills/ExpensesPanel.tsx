"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { MoneyInput } from "@/components/MoneyInput";
import type { Expense, Store } from "@/lib/types";

function todayInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString();
}

export function ExpensesPanel({ isAdmin }: { isAdmin: boolean }) {
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
    storeId: string;
  };
  const [edit, setEdit] = useState<EditForm | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const [form, setForm] = useState({
    category: "",
    payee: "",
    amountCents: 0,
    // Filled on mount (client-local date) — computing it during render would
    // mismatch the server's UTC date and break hydration on this page.
    expenseDate: "",
    memo: "",
    status: "PAID" as "PAID" | "UNPAID",
    storeId: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, c] = await Promise.all([
        api<{ expenses: Expense[] }>("/api/expenses"),
        api<{ categories: string[] }>("/api/expense-categories"),
      ]);
      setRows(e.expenses);
      setCategories(c.categories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load expenses");
    } finally {
      setLoading(false);
    }
  }, []);

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

  async function addCategory() {
    const name = prompt("New expense category:");
    if (!name || !name.trim()) return;
    try {
      const r = await api<{ categories: string[] }>("/api/expense-categories", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      setCategories(r.categories);
      setForm((f) => ({ ...f, category: name.trim() }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add category");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.category) {
      setError("Pick a category");
      return;
    }
    if (form.amountCents <= 0) {
      setError("Enter an amount");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/expenses", {
        method: "POST",
        body: JSON.stringify({
          category: form.category,
          payee: form.payee.trim(),
          amountCents: form.amountCents,
          expenseDate: form.expenseDate,
          memo: form.memo.trim(),
          status: form.status,
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
      storeId: r.storeId ?? "",
    });
  }

  async function saveEdit() {
    if (!edit) return;
    if (!edit.category) return setError("Pick a category");
    if (edit.amountCents <= 0) return setError("Enter an amount");
    setEditBusy(true);
    setError(null);
    try {
      await api(`/api/expenses/${edit.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          category: edit.category,
          payee: edit.payee.trim(),
          amountCents: edit.amountCents,
          expenseDate: edit.expenseDate,
          memo: edit.memo.trim(),
          status: edit.status,
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
          <div className="flex gap-1">
            <select
              className="input"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option value="">— Pick —</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addCategory}
              className="btn-secondary shrink-0 whitespace-nowrap px-2"
              title="Add a new category"
            >
              + New
            </button>
          </div>
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
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5">Date</th>
              <th className="px-4 py-2.5">Category</th>
              <th className="px-4 py-2.5">Payee</th>
              <th className="px-4 py-2.5">Memo</th>
              <th className="px-4 py-2.5">Store</th>
              <th className="px-4 py-2.5 text-right">Amount</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-400">
                  No expenses recorded yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 text-zinc-500">{fmtDate(r.expenseDate)}</td>
                  <td className="px-4 py-2.5 font-medium">{r.category}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{r.payee || "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{r.memo || "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {r.store?.name.replace(/^Chef and Beyond - /, "") ?? "Company-wide"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium">{formatMoney(r.amountCents)}</td>
                  <td className="px-4 py-2.5">
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
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
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
              ))
            )}
          </tbody>
        </table>
      </div>

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
                <select
                  className="input"
                  value={edit.category}
                  onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                >
                  <option value="">— Pick —</option>
                  {[...new Set([...categories, edit.category].filter(Boolean))].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
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
