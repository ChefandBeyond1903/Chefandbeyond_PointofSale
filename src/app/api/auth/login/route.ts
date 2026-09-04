import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { toRole } from "@/lib/auth";
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

    // Single active session per user: revoke every other session's refresh
    // token, keeping only the one just created. Other devices stay usable until
    // their current access token expires (~1h), then can't refresh.
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
