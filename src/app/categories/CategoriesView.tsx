"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { matchesSearch } from "@/lib/search";
import { usePaged } from "@/lib/usePaged";
import { Pager } from "@/components/Pager";
import { ListHeader, SearchBox } from "@/components/ListToolbar";
import { LoadingRow, EmptyRow } from "@/components/TableState";
import { CategoryIcon } from "@/components/CategoryIcon";
import type { Category } from "@/lib/types";

type Draft = { id?: string; name: string; favorite: boolean; iconUrl: string };
const emptyDraft: Draft = { name: "", favorite: false, iconUrl: "" };

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
      const payload = { name: draft.name, favorite: draft.favorite, iconUrl: draft.iconUrl.trim() };
      if (draft.id) {
        await api(`/api/categories/${draft.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/categories", { method: "POST", body: JSON.stringify(payload) });
      }
      setDraft(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save category");
    } finally {
      setSaving(false);
    }
  }

  // Quick toggle from the list — no need to open the editor for this.
  async function toggleFavorite(c: Category) {
    // Optimistic: the register reads this list too, so make it feel instant.
    setCategories((cur) =>
      cur.map((x) => (x.id === c.id ? { ...x, favorite: !c.favorite } : x)),
    );
    try {
      await api(`/api/categories/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ favorite: !c.favorite }),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update favorite");
      load();
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

      <p className="mb-3 text-xs text-zinc-400">
        Star a category to show it as an icon tile on the register — tapping it there shows your
        favorite products in that category. Give it a picture (e.g. from chefandbeyond.com) or
        leave it blank for a plain initial.
      </p>

      {error && !draft && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <Pager {...pg} className="mb-2 justify-end" />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5"></th>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5 text-right">Products</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <LoadingRow colSpan={4} />
            ) : pg.total === 0 ? (
              <EmptyRow colSpan={4}>
                {categories.length === 0
                  ? "No categories yet. Add one to start."
                  : "No categories match your search."}
              </EmptyRow>
            ) : (
              pg.pageItems.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5">
                    <CategoryIcon category={c} size={32} />
                  </td>
                  <td className="px-4 py-2.5 font-medium">
                    <div className="flex items-center gap-2">
                      {c.name}
                      <button
                        onClick={() => canManage && toggleFavorite(c)}
                        disabled={!canManage}
                        title={
                          c.favorite ? "Shown on the register — click to unstar" : "Star to show on the register"
                        }
                        className={`text-base leading-none ${
                          c.favorite ? "text-amber-400" : "text-zinc-300 hover:text-zinc-400"
                        } ${canManage ? "" : "cursor-default"}`}
                      >
                        {c.favorite ? "★" : "☆"}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-400">
                    {c._count?.products ?? 0}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {canManage && (
                      <>
                        <button
                          onClick={() =>
                            setDraft({
                              id: c.id,
                              name: c.name,
                              favorite: c.favorite,
                              iconUrl: c.iconUrl,
                            })
                          }
                          className="btn-ghost text-xs"
                        >
                          Edit
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
          <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-semibold">
              {draft.id ? "Edit category" : "New category"}
            </h2>

            <div className="space-y-3">
              <div>
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
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.favorite}
                  onChange={(e) => setDraft({ ...draft, favorite: e.target.checked })}
                />
                Show as an icon tile on the register
              </label>

              <div>
                <label className="label">Icon image URL (optional)</label>
                <div className="flex items-center gap-3">
                  <CategoryIcon
                    category={{ name: draft.name || "?", iconUrl: draft.iconUrl }}
                    size={40}
                  />
                  <input
                    className="input"
                    placeholder="https://…"
                    value={draft.iconUrl}
                    onChange={(e) => setDraft({ ...draft, iconUrl: e.target.value })}
                  />
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">
                  Paste a picture URL (e.g. copied from a chefandbeyond.com category page). Leave
                  blank to just show the category&apos;s initial.
                </p>
              </div>
            </div>

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
