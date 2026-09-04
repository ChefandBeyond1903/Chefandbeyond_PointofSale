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

  const links = LINKS.filter((l) => l.roles.includes(user.role));

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
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-1 px-4">
        <span className="mr-4 flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-xs font-bold text-white">
            CB
          </span>
          POS
        </span>
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {links.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            const watched = WATCHED.find((w) => w.href === l.href);
            // Hide the badge while the admin is actually on that section.
            const badge =
              watched && !active && isAdmin ? newCounts[watched.key] : 0;
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
  );
}
