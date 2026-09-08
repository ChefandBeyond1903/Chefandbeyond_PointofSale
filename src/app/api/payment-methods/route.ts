import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, requireScopedRole } from "@/lib/scope";
import { methodCode, RESERVED_METHOD_CODES } from "@/lib/payments";
import { ok, toErrorResponse } from "@/lib/api";

// The custom payment methods (Zelle, Venmo, wire, …). The built-in four live
// in code, not here.
export async function GET() {
  try {
    await requireScopedUser();
    const methods = await prisma.paymentMethod.findMany({
      orderBy: { label: "asc" },
      select: { id: true, code: true, label: true },
    });
    return ok({ methods });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireScopedRole("MANAGER", "ADMIN");
    const body = (await req.json()) as { label?: unknown };
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) throw new HttpError(400, "Enter a name for the payment method.");
    if (label.length > 40) throw new HttpError(400, "That name is too long.");
    const code = methodCode(label);
    if (!code) throw new HttpError(400, "That name has no letters or numbers.");
    if (RESERVED_METHOD_CODES.includes(code)) {
      throw new HttpError(400, `"${label}" is already a built-in payment method.`);
    }
    const existing = await prisma.paymentMethod.findUnique({ where: { code } });
    if (existing) throw new HttpError(400, `"${label}" is already on the list.`);
    const method = await prisma.paymentMethod.create({
      data: { code, label },
      select: { id: true, code: true, label: true },
    });
    return ok({ method }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
