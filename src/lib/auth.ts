import "server-only";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const SESSION_COOKIE = "cb_pos_session";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours (default)
const REMEMBER_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days ("remember me")

export type Role = "CASHIER" | "MANAGER" | "ADMIN";
export const ROLES: Role[] = ["CASHIER", "MANAGER", "ADMIN"];

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  // Populated by /api/auth/me from the database, not carried in the JWT.
  storeId?: string | null;
  storeName?: string | null;
  storeTaxRateBps?: number | null;
}

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short. Set it in .env");
  }
  return new TextEncoder().encode(s);
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createSessionToken(
  user: SessionUser,
  maxAgeSeconds = MAX_AGE_SECONDS,
): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(secret());
}

export async function readSessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payloadToUser(payload);
  } catch {
    return null;
  }
}

export function payloadToUser(payload: JWTPayload): SessionUser | null {
  if (!payload.sub || typeof payload.email !== "string") return null;
  const role: Role =
    payload.role === "ADMIN" ? "ADMIN" : payload.role === "MANAGER" ? "MANAGER" : "CASHIER";
  return {
    id: payload.sub,
    email: payload.email,
    name: typeof payload.name === "string" ? payload.name : payload.email,
    role,
  };
}

export async function startSession(user: SessionUser, remember = false): Promise<void> {
  const maxAge = remember ? REMEMBER_AGE_SECONDS : MAX_AGE_SECONDS;
  const token = await createSessionToken(user, maxAge);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Current user from the session cookie, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSessionToken(token);
}

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
