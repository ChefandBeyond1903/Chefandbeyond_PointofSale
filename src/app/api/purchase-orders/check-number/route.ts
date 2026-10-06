import { NextRequest } from "next/server";
import { requireScopedUser } from "@/lib/scope";
import { findPoNumberConflict } from "@/lib/purchaseOrder";
import { ok, toErrorResponse } from "@/lib/api";

// Live duplicate check while typing a PO number on the form — unscoped by
// store, since PurchaseOrder.poNumber is effectively unique (a conflict in
// another store still blocks the save), and case/punctuation-insensitive
// ("CB-28785", "cb28785" and "Cb 28785" all collide).
export async function GET(req: NextRequest) {
  try {
    await requireScopedUser();
    const { searchParams } = new URL(req.url);
    const number = searchParams.get("number")?.trim();
    const excludeId = searchParams.get("excludeId")?.trim() || undefined;
    if (!number) return ok({ conflict: null });

    const conflict = await findPoNumberConflict(number, excludeId);
    return ok({ conflict });
  } catch (err) {
    return toErrorResponse(err);
  }
}
