"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Role, SessionUser } from "@/lib/types";
import { api } from "@/lib/client";

const ALL: Role[] = ["CASHIER", "MANAGER", "ADMIN"];
const STAFF_UP: Role[] = ["MANAGER", "ADMIN"];
const ADMIN_ONLY: Role[] = ["ADMIN"];

const LINKS: { href: string; label: string; roles: Role[] }[] = [
  { href: "/overview", label: "Overview", roles: ADMIN_ONLY },
  { href: "/", label: "Register", roles: ALL },
  { href: "/invoices", label: "Invoices", roles: ALL },
  { href: "/products", label: "Products", roles: ALL },
  { href: "/vendors", label: "Vendors", roles: ALL },
  { href: "/customers", label: "Customers", roles: ALL },
  { href: "/purchase-orders", label: "Purchase Orders", roles: ALL },
  { href: "/bills", label: "Bills", roles: STAFF_UP },
  { href: "/inventory", label: "Inventory", roles: ALL },
  { href: "/reports", label: "Reports", roles: ALL },
  { href: "/users", label: "Staff", roles: STAFF_UP },
  { href: "/settings", label: "Settings", roles: STAFF_UP },
];

// Nav tabs that show an admin "new since you last looked" badge. `key` matches
// both the /api/activity/new-counts response and the localStorage marker.
type NewKey = "vendors" | "customers" | "purchaseOrders" | "bills" | "users";
const WATCHED: { key: NewKey; href: string }[] = [
  { key: "vendors", href: "/vendors" },
  { key: "customers", href: "/customers" },
  { key: "purchaseOrders", href: "/purchase-orders" },
  { key: "bills", href: "/bills" },
  { key: "users", href: "/users" },
];
const SEEN_PREFIX = "cb-pos-seen-";

function getSeen(key: NewKey): string {
  try {
    return localStorage.getItem(SEEN_PREFIX + key) || "";
  } catch {
    return "";
  }
}
function setSeen(key: NewKey, iso: string) {
  try {
    localStorage.setItem(SEEN_PREFIX + key, iso);
  } catch {
    /* private mode / storage disabled — badges just won't persist */
  }
}

export function Nav({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newCounts, setNewCounts] = useState<Record<NewKey, number>>({
    vendors: 0,
    customers: 0,
    purchaseOrders: 0,
    bills: 0,
    users: 0,
  });

  const isAdmin = user.role === "ADMIN";

  const refreshNewCounts = useCallback(async () => {
    if (!isAdmin) return;
    const qs = new URLSearchParams();
    for (const w of WATCHED) qs.set(w.key, getSeen(w.key));
    try {
      const r = await api<Record<NewKey, number>>(`/api/activity/new-counts?${qs.toString()}`);
      setNewCounts(r);
    } catch {
      /* non-fatal — leave the last known counts */
    }
  }, [isAdmin]);

  // First run seeds every marker to "now" so nothing shows as new until
  // something is actually added later. Then poll on an interval and on focus.
  useEffect(() => {
    if (!isAdmin) return;
    const now = new Date().toISOString();
    for (const w of WATCHED) if (!getSeen(w.key)) setSeen(w.key, now);
    refreshNewCounts();
    const id = setInterval(refreshNewCounts, 60_000);
    const onFocus = () => refreshNewCounts();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [isAdmin, refreshNewCounts]);

  // Landing on a watched section marks it seen; leaving it re-checks so a stale
  // count doesn't linger.
  useEffect(() => {
    if (!isAdmin) return;
    const hit = WATCHED.find((w) => pathname.startsWith(w.href));
    if (hit) setSeen(hit.key, new Date().toISOString());
    refreshNewCounts();
  }, [pathname, isAdmin, refreshNewCounts]);

  // A navigation (including the back/forward buttons) closes the mobile drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Block background scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  const links = LINKS.filter((l) => l.roles.includes(user.role));

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }
  // Hide the badge while the user is actually on that section.
  function badgeFor(href: string) {
    if (!isAdmin || isActive(href)) return 0;
    const watched = WATCHED.find((w) => w.href === href);
    return watched ? newCounts[watched.key] : 0;
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Session may already be gone — still send the user to the login page.
    } finally {
      router.push("/login");
      router.refresh();
      setLoggingOut(false);
    }
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white">
        {/* Mobile bar: tapping the logo opens the slide-out menu. */}
        <div className="flex h-14 items-center px-2 sm:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            className="-ml-0.5 flex items-center gap-2 rounded-md py-1.5 pl-2 pr-3 font-semibold tracking-tight hover:bg-zinc-50"
            aria-label="Open menu"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M2 4.5h14M2 9h14M2 13.5h14" />
            </svg>
            <span className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-xs font-bold text-white">
              CB
            </span>
            POS
          </button>
        </div>

        {/* Desktop bar: full horizontal tab strip. */}
        <div className="mx-auto hidden h-14 w-full max-w-[1600px] items-center gap-1 px-4 sm:flex">
          <span className="mr-4 flex shrink-0 items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-xs font-bold text-white">
              CB
            </span>
            POS
          </span>
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {links.map((l) => {
              const active = isActive(l.href);
              const badge = badgeFor(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`flex shrink-0 items-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
                  }`}
                >
                  {l.label}
                  {badge > 0 && (
                    <span
                      className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white"
                      title={`${badge} new since you last looked`}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          <div className="flex shrink-0 items-center gap-3 pl-2 text-sm">
            <span className="hidden whitespace-nowrap text-zinc-500 sm:inline">
              {user.name} · <span className="capitalize">{user.role.toLowerCase()}</span>
            </span>
            <button
              onClick={logout}
              disabled={loggingOut}
              className="btn-secondary shrink-0 whitespace-nowrap"
            >
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile slide-out menu */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div
            className="cbpos-overlay absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="cbpos-drawer absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-zinc-900 text-zinc-100 shadow-2xl">
            <div className="flex items-start justify-between px-4 pb-3 pt-5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-indigo-600 text-sm font-bold text-white">
                  CB
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold leading-tight tracking-tight">
                    Chef &amp; Beyond POS
                  </p>
                  <p className="text-[11px] uppercase tracking-wide text-zinc-400">
                    {user.role.toLowerCase()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                aria-label="Close menu"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M3.5 3.5l11 11M14.5 3.5l-11 11" />
                </svg>
              </button>
            </div>
            <div className="border-t border-zinc-800" />
            <nav className="flex-1 overflow-y-auto py-2">
              {links.map((l) => {
                const active = isActive(l.href);
                const badge = badgeFor(l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`flex items-center justify-between border-l-[3px] px-4 py-3 text-[15px] font-medium transition-colors ${
                      active
                        ? "border-indigo-500 bg-zinc-800 text-white"
                        : "border-transparent text-zinc-300 hover:bg-zinc-800/60 hover:text-white"
                    }`}
                  >
                    <span>{l.label}</span>
                    {badge > 0 && (
                      <span
                        className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-500 px-1.5 text-[11px] font-bold text-white"
                        title={`${badge} new since you last looked`}
                      >
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-zinc-800 px-4 py-3">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <button
                onClick={logout}
                disabled={loggingOut}
                className="mt-0.5 text-xs text-zinc-400 hover:text-white disabled:opacity-50"
              >
                {loggingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
