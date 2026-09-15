import { NextRequest } from "next/server";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, requireScopedRole, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";
import { listReaders, registerReader } from "@/lib/terminal";
import { stripeConfigured, stripeTestMode } from "@/lib/stripe";

// Card readers the caller can use: their store's (any store for an admin).
export async function GET() {
  try {
    const u = await requireScopedUser();
    const scope = scopeStoreId(u);
    const readers = stripeConfigured() ? await listReaders(scope ? [scope] : null) : [];
    return ok({ readers, configured: stripeConfigured(), testMode: stripeTestMode() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Pair a reader (manager: own store; admin: any store) with its pairing code.
export async function POST(req: NextRequest) {
  try {
    const u = await requireScopedRole("MANAGER", "ADMIN");
    const body = (await req.json()) as { registrationCode?: unknown; label?: unknown; storeId?: unknown };
    const code = typeof body.registrationCode === "string" ? body.registrationCode.trim() : "";
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!code) throw new HttpError(400, "Enter the pairing code shown on the reader.");
    if (!label) throw new HttpError(400, "Give the reader a name (e.g. Front counter).");
    if (label.length > 60) throw new HttpError(400, "That name is too long.");
    const storeId =
      u.role === "ADMIN" ? (typeof body.storeId === "string" ? body.storeId : "") : (u.storeId ?? "");
    if (!storeId) throw new HttpError(400, "Choose which store this reader belongs to.");
    const reader = await registerReader({ storeId, registrationCode: code, label });
    return ok({ reader: { id: reader.id, label: reader.label, deviceType: reader.deviceType } }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
