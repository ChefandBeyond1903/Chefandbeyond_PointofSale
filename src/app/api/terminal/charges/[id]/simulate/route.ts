import { NextRequest } from "next/server";
import { requireScopedRole } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";
import { simulateTap } from "@/lib/terminal";

type Params = { params: Promise<{ id: string }> };

// Sandbox only (refuses on a live key): pretend the customer tapped a test
// card on a simulated reader, so the whole flow can be exercised without
// hardware.
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    await requireScopedRole("ADMIN");
    const { id } = await params;
    await simulateTap(id);
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
