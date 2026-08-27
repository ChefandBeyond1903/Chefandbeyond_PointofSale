import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, hashPassword, HttpError } from "@/lib/auth";
import { userUpdateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireRole("MANAGER");
    const { id } = await params;
    const body = userUpdateSchema.parse(await req.json());

    if (id === actor.id && body.active === false) {
      throw new HttpError(400, "You cannot deactivate your own account");
    }
    if (id === actor.id && body.role && body.role !== "MANAGER") {
      throw new HttpError(400, "You cannot remove your own manager role");
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.role !== undefined) data.role = body.role;
    if (body.active !== undefined) data.active = body.active;
    if (body.password) data.passwordHash = await hashPassword(body.password);

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
    });
    return ok({ user });
  } catch (err) {
    return toErrorResponse(err);
  }
}
