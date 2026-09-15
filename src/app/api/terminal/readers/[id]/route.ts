import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedRole } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";
import { removeReader } from "@/lib/terminal";

type Params = { params: Promise<{ id: string }> };

// Unpair a reader. A manager can only remove their own store's readers.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const u = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    const row = await prisma.cardReader.findUnique({ where: { id }, select: { storeId: true } });
    if (!row) throw new HttpError(404, "Reader not found");
    if (u.role !== "ADMIN" && row.storeId !== u.storeId) throw new HttpError(403, "Not your store's reader");
    await removeReader(id);
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
