"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

type Hit = { id: string; title: string; subtitle: string; href: string };
type SearchResults = {
  products: Hit[];
  customers: Hit[];
  vendors: Hit[];
  purchaseOrders: Hit[];
  invoices: Hit[];
  quotes: Hit[];
  bills: Hit[];
};

const EMPTY: SearchResults = {
  products: [],
  customers: [],
  vendors: [],
  purchaseOrders: [],
  invoices: [],
  quotes: [],
  bills: [],
};

const GROUPS: { key: keyof SearchResults; label: string }[] = [
  { key: "invoices", label: "Invoices" },
  { key: "quotes", label: "Quotes" },
  { key: "customers", label: "Customers" },
  { key: "products", label: "Products" },
  { key: "vendors", label: "Vendors" },
  { key: "purchaseOrders", label: "Purchase orders" },
  { key: "bills", label: "Bills" },
];

const MIN_CHARS = 2;

/** "Search everything" box for the header — one box across invoices, quotes,
 * customers, products, vendors, purchase orders, and bills. Picking a result
 * navigates to the page that owns that record (opening it directly via that
 * page's own `?open=<id>` deep link where one exists). */
export function GlobalSearch({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = term.trim();
    if (q.length < MIN_CHARS) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      api<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`)
        .then(setResults)
        .catch(() => setResults(EMPTY))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [term]);

  function go(href: string) {
    setOpen(false);
    setTerm("");
    setResults(EMPTY);
    inputRef.current?.blur();
    router.push(href);
  }

  const groups = GROUPS.map((g) => ({ ...g, items: results[g.key] })).filter(
    (g) => g.items.length > 0,
  );
  const trimmed = term.trim();
  const hasQuery = trimmed.length > 0;
  const belowMin = hasQuery && trimmed.length < MIN_CHARS;
  const hasResults = groups.length > 0;

  return (
    <div className={`relative ${className}`}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="5.5" />
        <path d="M16 16l-3.2-3.2" />
      </svg>
      <input
        ref={inputRef}
        className="input h-8 w-full pl-8 text-sm"
        placeholder="Search everything…"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          } else if (e.key === "Enter" && hasResults) {
            go(groups[0].items[0].href);
          }
        }}
        aria-label="Search everything in the POS"
      />
      {open && hasQuery && (
        <div className="absolute right-0 z-50 mt-1 max-h-[70vh] w-80 overflow-auto rounded-md border border-zinc-200 bg-white text-sm shadow-lg">
          {belowMin ? (
            <p className="px-3 py-3 text-zinc-400">Keep typing…</p>
          ) : loading && !hasResults ? (
            <p className="px-3 py-3 text-zinc-400">Searching…</p>
          ) : !hasResults ? (
            <p className="px-3 py-3 text-zinc-400">No matches for &ldquo;{trimmed}&rdquo;.</p>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="border-b border-zinc-100 py-1 last:border-0">
                <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  {g.label}
                </p>
                {g.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      go(item.href);
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-indigo-50"
                  >
                    <span className="block truncate font-medium text-zinc-800">{item.title}</span>
                    {item.subtitle && (
                      <span className="block truncate text-xs text-zinc-400">{item.subtitle}</span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
