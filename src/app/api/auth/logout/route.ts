import { supabaseServer } from "@/lib/supabase";
import { ok } from "@/lib/api";

export async function POST() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return ok({ ok: true });
}
