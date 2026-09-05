"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { matchesSearch } from "@/lib/search";
import { usePaged } from "@/lib/usePaged";
import { Pager } from "@/components/Pager";
import { ListHeader, SearchBox } from "@/components/ListToolbar";
import { LoadingRow, EmptyRow } from "@/components/TableState";
import type { Category } from "@/lib/types";

type Draft = { id?: string; name: string };
const emptyDraft: Draft = { name: "" };

export function CategoriesView({ canManage = true }: { canManage?: boolean }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim();
    if (!s) return categories;
    return categories.filter((c) => matchesSearch(s, [c.name]));
  }, [categories, q]);

  const pg = usePaged(filtered);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ categories: Category[] }>("/api/categories");
      setCategories(res.categories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load categories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      if (draft.id) {
        await api(`/api/categories/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: draft.name }),
        });
      } else {
        await api("/api/categories", { method: "POST", body: JSON.stringify({ name: draft.name }) });
      }
      setDraft(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save category");
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Category) {
    const count = c._count?.products ?? 0;
    const warn =
      count > 0
        ? `\n\n${count} product(s) use this category — they'll be left with no category.`
        : "";
    if (!confirm(`Delete category "${c.name}"?${warn}`)) return;
    try {
      await api(`/api/categories/${c.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete category");
    }
  }

  return (
    <div className="w-full flex-1 p-4">
      <ListHeader title="Categories">
        <SearchBox value={q} onChange={setQ} placeholder="Search categories…" />
        {canManage ? (
          <button onClick={() => setDraft({ ...emptyDraft })} className="btn-primary ml-auto">
            + New category
          </button>
        ) : (
          <span className="ml-auto text-xs text-zinc-400">View only</span>
        )}
      </ListHeader>

      {error && !draft && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <Pager {...pg} className="mb-2 justify-end" />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5 text-right">Products</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <LoadingRow colSpan={3} />
            ) : pg.total === 0 ? (
              <EmptyRow colSpan={3}>
                {categories.length === 0
                  ? "No categories yet. Add one to start."
                  : "No categories match your search."}
              </EmptyRow>
            ) : (
              pg.pageItems.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 font-medium">{c.name}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-400">
                    {c._count?.products ?? 0}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {canManage && (
                      <>
                        <button
                          onClick={() => setDraft({ id: c.id, name: c.name })}
                          className="btn-ghost text-xs"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => remove(c)}
                          className="btn-ghost text-xs text-red-500"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setDraft(null)}
        >
          <div
            className="card w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold">
              {draft.id ? "Rename category" : "New category"}
            </h2>
            <label className="label">Name</label>
            <input
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.name.trim()) save();
              }}
              autoFocus
            />

            {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="mt-5 flex gap-2">
              <button onClick={() => setDraft(null)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !draft.name.trim()}
                className="btn-primary flex-1"
              >
                {saving ? "Saving…" : "Save category"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
