import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, requireRole } from "@/lib/auth";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

// Delete a run (to redo it). Year-to-date wage caps on LATER runs were computed
// with this one included, so delete newest-first and re-enter from there.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireRole("ADMIN");
    const { id } = await params;
    const run = await prisma.payrollRun.findUnique({ where: { id }, select: { payDate: true } });
    if (!run) throw new HttpError(404, "Pay run not found");
    await prisma.payrollRun.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
