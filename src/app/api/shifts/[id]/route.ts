import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { shiftCloseSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

// Close a shift.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = shiftCloseSchema.parse(await req.json());

    const shift = await prisma.shift.findUnique({ where: { id } });
    if (!shift) throw new HttpError(404, "Shift not found");
    if (shift.userId !== user.id && user.role !== "MANAGER") {
      throw new HttpError(403, "You can only close your own shift");
    }
    if (shift.status === "CLOSED") throw new HttpError(400, "Shift is already closed");

    const updated = await prisma.shift.update({
      where: { id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closingCountCents: body.closingCountCents,
      },
    });
    return ok({ shift: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
