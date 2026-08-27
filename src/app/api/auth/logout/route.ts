import { endSession } from "@/lib/auth";
import { ok } from "@/lib/api";

export async function POST() {
  await endSession();
  return ok({ ok: true });
}
