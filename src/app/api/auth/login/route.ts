import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { toRole } from "@/lib/auth";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase";
import { loginSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

export async function POST(req: NextRequest) {
  try {
    const body = loginSchema.parse(await req.json());
    const supabase = await supabaseServer();

    const genericError = () => ok({ error: "Invalid email or password" }, 401);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email.toLowerCase(),
      password: body.password,
    });
    if (error || !data.user) return genericError();

    const row = await prisma.user.findUnique({
      where: { authId: data.user.id },
      select: { id: true, email: true, name: true, role: true, active: true },
    });
    if (!row || !row.active) {
      await supabase.auth.signOut();
      return genericError();
    }

    // Single active session per user. Rotate the session token: this device
    // gets the new one in a cookie, and every other device's cookie stops
    // matching on its next request, logging it out.
    const sessionToken = randomUUID();
    await prisma.user.update({ where: { id: row.id }, data: { sessionToken } });
    (await cookies()).set(SESSION_COOKIE, sessionToken, SESSION_COOKIE_OPTIONS);

    // Also revoke the other sessions' Supabase refresh tokens so they can't
    // silently refresh even before the cookie check catches them.
    await supabase.auth.signOut({ scope: "others" }).catch((e) => {
      console.warn("Could not sign out other sessions:", e);
    });

    return ok({
      user: { id: row.id, email: row.email, name: row.name, role: toRole(row.role) },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
