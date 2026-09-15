import { NextRequest } from "next/server";
import { requireScopedUser } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";
import { cancelCharge, chargeStatus } from "@/lib/terminal";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireScopedUser();
    const { id } = await params;
    return ok(await chargeStatus(id));
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Cashier hit Cancel while the reader was waiting for a card.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireScopedUser();
    const { id } = await params;
    await cancelCharge(id);
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
