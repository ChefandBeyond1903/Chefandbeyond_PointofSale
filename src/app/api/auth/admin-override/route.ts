import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser } from "@/lib/scope";
import { issueAdminOverrideToken } from "@/lib/adminOverride";
import { ok, toErrorResponse } from "@/lib/api";

const schema = z.object({ adminId: z.string().min(1), password: z.string().min(1) });
// adminId is the admin — or store manager — whose password is being entered.

// Wrong-password attempts per operator — a register shouldn't be a
// password-guessing tool for the admin account.
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;

// Staff picks an admin (any store) or a manager (their own store) as the
// salesperson and types that person's password to use override rights (e.g.
// sell below a minimum price) on the sale. A manager may also unlock their own.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const body = schema.parse(await req.json());

    const now = Date.now();
    const rec = attempts.get(actor.id);
    if (rec && rec.resetAt > now && rec.count >= MAX_ATTEMPTS) {
      throw new HttpError(429, "Too many wrong passwords. Try again in a few minutes.");
    }

    const admin = await prisma.user.findFirst({
      where: {
        id: body.adminId,
        active: true,
        OR:
          actor.role === "ADMIN"
            ? [{ role: "ADMIN" }, { role: "MANAGER" }]
            : [
                { role: "ADMIN" },
                { role: "MANAGER", storeId: actor.storeId ?? "__none__" },
              ],
      },
      select: { id: true, email: true, name: true },
    });
    if (!admin) throw new HttpError(400, "That person isn't available for override.");

    // Check the password on a throwaway client so this never touches the
    // operator's own session or the admin's single-login token.
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data, error } = await client.auth.signInWithPassword({
      email: admin.email.toLowerCase(),
      password: body.password,
    });
    if (error || !data.session) {
      const fresh = rec && rec.resetAt > now ? rec : { count: 0, resetAt: now + WINDOW_MS };
      fresh.count += 1;
      attempts.set(actor.id, fresh);
      throw new HttpError(401, "Incorrect password.");
    }
    await client.auth.signOut({ scope: "local" }).catch(() => {});
    attempts.delete(actor.id);

    const { token, expiresAt } = issueAdminOverrideToken(actor.id, admin.id);
    return ok({ token, expiresAt, adminId: admin.id, adminName: admin.name });
  } catch (err) {
    return toErrorResponse(err);
  }
}
