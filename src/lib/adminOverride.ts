import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// Short-lived proof that an admin's password was entered at this register.
// Signed with the server-only service key, bound to the operator who entered
// it and to the admin whose rights are being used.
const TTL_MS = 30 * 60 * 1000;

function secret(): string {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueAdminOverrideToken(actorId: string, adminId: string) {
  const expiresAt = Date.now() + TTL_MS;
  const payload = Buffer.from(JSON.stringify({ a: actorId, m: adminId, e: expiresAt })).toString(
    "base64url",
  );
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

/** True when the token is genuine, unexpired, and issued to this operator
 *  (and, when given, for this admin). */
export function verifyAdminOverrideToken(
  token: string | undefined,
  actorId: string,
  adminId?: string | null,
): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const { a, m, e } = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      a: string;
      m: string;
      e: number;
    };
    if (a !== actorId || e < Date.now()) return false;
    return adminId === undefined || adminId === null ? true : m === adminId;
  } catch {
    return false;
  }
}
