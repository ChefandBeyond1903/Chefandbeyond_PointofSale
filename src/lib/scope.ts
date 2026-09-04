import "server-only";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError, type Role, type SessionUser } from "@/lib/auth";

export interface ScopedUser extends SessionUser {
  /** The user's assigned store, or null (ADMIN, or unassigned). */
  storeId: string | null;
}

/**
 * The session user plus their current role and store, read fresh from the DB so
 * a role/store change takes effect without a re-login.
 */
export async function requireScopedUser(): Promise<ScopedUser> {
  const s = await requireUser();
  const row = await prisma.user.findUnique({
    where: { id: s.id },
    select: { role: true, storeId: true, active: true },
  });
  if (!row || !row.active) throw new HttpError(401, "Not signed in");
  const role: Role =
    row.role === "ADMIN" ? "ADMIN" : row.role === "MANAGER" ? "MANAGER" : "CASHIER";
  return { ...s, role, storeId: row.storeId ?? null };
}

/** Like requireScopedUser, but 403s unless the role is one of `roles`. */
export async function requireScopedRole(...roles: Role[]): Promise<ScopedUser> {
  const u = await requireScopedUser();
  if (!roles.includes(u.role)) throw new HttpError(403, "Insufficient permissions");
  return u;
}

/**
 * The store a user's data is limited to. ADMIN sees every store (null); everyone
 * else is limited to their assigned store. An unassigned non-admin resolves to
 * "__none__" so their queries return nothing rather than everything.
 */
export function scopeStoreId(u: ScopedUser): string | null {
  if (u.role === "ADMIN") return null;
  return u.storeId ?? "__none__";
}

/** Prisma `where` fragment for a `storeId` column, honoring the user's scope. */
export function storeWhere(u: ScopedUser): { storeId?: string } {
  const s = scopeStoreId(u);
  return s ? { storeId: s } : {};
}

/**
 * 404s unless the caller may see this customer — their own store's, or any if
 * they're an admin. Customers are created per store (Customer.storeId).
 */
export async function assertCustomerInScope(customerId: string, u: ScopedUser): Promise<void> {
  const scoped = scopeStoreId(u);
  if (!scoped) return;
  const row = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { storeId: true },
  });
  if (!row || row.storeId !== scoped) throw new HttpError(404, "Customer not found");
}
