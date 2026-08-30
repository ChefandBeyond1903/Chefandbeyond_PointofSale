import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { requireScopedUser } from "@/lib/scope";
import { userUpdateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  createdAt: true,
  storeId: true,
  store: { select: { id: true, name: true, taxRateBps: true } },
  createdById: true,
  createdBy: { select: { id: true, name: true } },
} as const;

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const body = userUpdateSchema.parse(await req.json());

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, storeId: true, createdById: true, authId: true },
    });
    if (!target) throw new HttpError(404, "User not found");

    // --- who may touch this row, and which fields ---
    const isSelf = id === actor.id;
    if (actor.role === "CASHIER" && target.createdById !== actor.id) {
      throw new HttpError(403, "You can only manage staff you created");
    }
    if (actor.role === "MANAGER" && !isSelf) {
      if (target.role === "ADMIN" || target.storeId !== actor.storeId) {
        throw new HttpError(403, "That user is not in your store");
      }
    }

    if (isSelf && body.active === false) {
      throw new HttpError(400, "You cannot deactivate your own account");
    }
    if (isSelf && body.role && body.role !== actor.role) {
      throw new HttpError(400, "You cannot change your own role");
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.password) {
      if (!target.authId) throw new HttpError(409, "This account has no linked login");
      const { error } = await supabaseAdmin().auth.admin.updateUserById(target.authId, {
        password: body.password,
      });
      if (error) throw new HttpError(500, `Could not update password: ${error.message}`);
    }
    if (body.active !== undefined) data.active = body.active;

    // Role changes: cashiers can't; managers can set CASHIER/MANAGER only.
    if (body.role !== undefined) {
      if (actor.role === "CASHIER") throw new HttpError(403, "You cannot change roles");
      if (actor.role === "MANAGER" && body.role === "ADMIN") {
        throw new HttpError(403, "Managers cannot grant admin");
      }
      data.role = body.role;
    }

    // Store reassignment: cashiers can't; managers only within their own store.
    if (body.storeId !== undefined) {
      if (actor.role === "CASHIER") throw new HttpError(403, "You cannot reassign stores");
      const next = body.storeId ? body.storeId : null;
      if (actor.role === "MANAGER" && next !== actor.storeId) {
        throw new HttpError(403, "Managers can only assign staff to their own store");
      }
      data.storeId = next;
    }

    const user = await prisma.user.update({ where: { id }, data, select: userSelect });
    return ok({ user });
  } catch (err) {
    return toErrorResponse(err);
  }
}
