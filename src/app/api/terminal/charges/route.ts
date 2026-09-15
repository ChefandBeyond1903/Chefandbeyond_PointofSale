import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";
import { startCharge } from "@/lib/terminal";

// Push an amount to a card reader. The register then polls GET /charges/[id]
// and, once the intent succeeds, submits the sale with the intent id.
export async function POST(req: NextRequest) {
  try {
    const u = await requireScopedUser();
    const body = (await req.json()) as { readerId?: unknown; amountCents?: unknown; description?: unknown };
    const readerId = typeof body.readerId === "string" ? body.readerId : "";
    const amountCents = typeof body.amountCents === "number" ? Math.round(body.amountCents) : 0;
    if (!readerId) throw new HttpError(400, "Pick a card reader.");
    const reader = await prisma.cardReader.findUnique({ where: { id: readerId }, select: { storeId: true } });
    if (!reader) throw new HttpError(404, "That card reader is no longer paired.");
    if (u.role !== "ADMIN" && reader.storeId !== u.storeId) {
      throw new HttpError(403, "That reader belongs to another store.");
    }
    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim().slice(0, 200)
        : "Chef and Beyond POS sale";
    const res = await startCharge({ readerId, amountCents, cashierId: u.id, description });
    return ok(res, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
