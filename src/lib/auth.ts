import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase";

export type Role = "CASHIER" | "MANAGER" | "ADMIN";
export const ROLES: Role[] = ["CASHIER", "MANAGER", "ADMIN"];

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  // Populated by /api/auth/me from the database, not carried in the session.
  storeId?: string | null;
  storeName?: string | null;
  storeTaxRateBps?: number | null;
}

export function toRole(value: unknown): Role {
  return value === "ADMIN" ? "ADMIN" : value === "MANAGER" ? "MANAGER" : "CASHIER";
}

/**
 * Current user, or null. Authentication comes from the Supabase session
 * cookie (browser) or, when there is no cookie session to read, an
 * `Authorization: Bearer <sessionToken>` header — the mobile app has no
 * cookie jar to rely on, so it sends back the same opaque token /api/auth/
 * login issues and rotates, checked directly against the User row with no
 * Supabase round trip. Either way, deactivated staff or a token superseded
 * by a login elsewhere comes back signed out. Cached per request.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const bearer = (await headers()).get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (bearer) {
    const row = await prisma.user.findFirst({
      where: { sessionToken: bearer, active: true },
      select: { id: true, email: true, name: true, role: true },
    });
    return row ? { id: row.id, email: row.email, name: row.name, role: toRole(row.role) } : null;
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const row = await prisma.user.findUnique({
    where: { authId: user.id },
    select: { id: true, email: true, name: true, role: true, active: true, sessionToken: true },
  });
  if (!row || !row.active) return null;

  // Single active session: the token this device got at login must still be
  // the current one. A login elsewhere rotates it, signing this device out.
  if (row.sessionToken) {
    const cookieToken = (await cookies()).get(SESSION_COOKIE)?.value;
    if (cookieToken !== row.sessionToken) return null;
  }

  return { id: row.id, email: row.email, name: row.name, role: toRole(row.role) };
});

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Returns the user or throws HttpError(401). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Not signed in");
  return user;
}

/** Returns the user or throws HttpError(401/403). */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) throw new HttpError(403, "Insufficient permissions");
  return user;
}
