"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { Role, SessionUser } from "@/lib/types";
import { api } from "@/lib/client";

const ALL: Role[] = ["CASHIER", "MANAGER", "ADMIN"];
const STAFF_UP: Role[] = ["MANAGER", "ADMIN"];

const LINKS: { href: string; label: string; roles: Role[] }[] = [
  { href: "/", label: "Register", roles: ALL },
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

export function Nav({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

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
      <div className="flex h-14 w-full items-center gap-1 px-4">
        <span className="mr-4 flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-xs font-bold text-white">
            CB
          </span>
          POS
        </span>
        <nav className="flex items-center gap-1">
          {links.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden text-zinc-500 sm:inline">
            {user.name} · <span className="capitalize">{user.role.toLowerCase()}</span>
          </span>
          <button onClick={logout} disabled={loggingOut} className="btn-secondary">
            {loggingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </header>
  );
}
