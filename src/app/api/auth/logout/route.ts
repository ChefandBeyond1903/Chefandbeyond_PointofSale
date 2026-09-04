import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase";
import { SESSION_COOKIE } from "@/lib/session";
import { ok } from "@/lib/api";

export async function POST() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  (await cookies()).delete(SESSION_COOKIE);
  return ok({ ok: true });
}
