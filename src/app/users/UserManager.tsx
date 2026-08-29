"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatBps } from "@/lib/money";
import type { ManagedUser, Role, Store } from "@/lib/types";

export function UserManager({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "CASHIER" as Role,
    storeId: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, s] = await Promise.all([
        api<{ users: ManagedUser[] }>("/api/users"),
        api<{ stores: Store[] }>("/api/stores?all=1"),
      ]);
      setUsers(u.users);
      setStores(s.stores);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load staff");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", email: "", password: "", role: "CASHIER", storeId: "" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create user");
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await api(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function resetPassword(u: ManagedUser) {
    const pw = prompt(`New password for ${u.name} (min 8 chars):`);
    if (!pw) return;
    if (pw.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    patch(u.id, { password: pw });
  }

  const activeStores = stores.filter((s) => s.active);

  return (
    <div className="w-full flex-1 p-4">
      <h1 className="mb-4 text-xl font-semibold">Staff</h1>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {stores.length === 0 && (
        <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">
          No stores yet. Add one under{" "}
          <a href="/settings" className="underline">
            Settings
          </a>{" "}
          so staff can be assigned a location and tax rate.
        </p>
      )}

      <form onSubmit={createUser} className="card mb-6 grid grid-cols-1 gap-3 p-4 sm:grid-cols-6">
        <input
          className="input sm:col-span-1"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <input
          className="input sm:col-span-2"
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <input
          className="input"
          type="text"
          placeholder="Password (8+)"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        <select
          className="input"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
        >
          <option value="CASHIER">Cashier</option>
          <option value="MANAGER">Manager</option>
        </select>
        <div className="flex gap-2">
          <select
            className="input"
            value={form.storeId}
            onChange={(e) => setForm({ ...form, storeId: e.target.value })}
          >
            <option value="">No store</option>
            {activeStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({formatBps(s.taxRateBps)})
              </option>
            ))}
          </select>
          <button className="btn-primary whitespace-nowrap" disabled={creating}>
            Add
          </button>
        </div>
      </form>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Store</th>
              <th className="px-4 py-2.5 text-right">Sales</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const self = u.id === currentUserId;
                return (
                  <tr key={u.id} className={u.active ? "" : "opacity-50"}>
                    <td className="px-4 py-2.5 font-medium">
                      {u.name}
                      {self && <span className="ml-2 text-xs text-zinc-400">(you)</span>}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500">{u.email}</td>
                    <td className="px-4 py-2.5">
                      <select
                        className="input h-8 w-32"
                        value={u.role}
                        disabled={self}
                        onChange={(e) => patch(u.id, { role: e.target.value })}
                      >
                        <option value="CASHIER">Cashier</option>
                        <option value="MANAGER">Manager</option>
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        className="input h-8 w-44"
                        value={u.storeId ?? ""}
                        onChange={(e) => patch(u.id, { storeId: e.target.value })}
                      >
                        <option value="">No store</option>
                        {stores.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({formatBps(s.taxRateBps)})
                            {!s.active ? " — inactive" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500">{u._count?.sales ?? 0}</td>
                    <td className="px-4 py-2.5">
                      {u.active ? (
                        <span className="text-green-600">Active</span>
                      ) : (
                        <span className="text-zinc-400">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => resetPassword(u)} className="btn-ghost text-xs">
                        Reset password
                      </button>
                      {!self && (
                        <button
                          onClick={() => patch(u.id, { active: !u.active })}
                          className="btn-ghost text-xs"
                        >
                          {u.active ? "Deactivate" : "Reactivate"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
