import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword, HttpError } from "@/lib/auth";
import { requireScopedUser } from "@/lib/scope";
import { userCreateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

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

type Row = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/** Can `actor` edit this staff row? */
function canEdit(actor: { id: string; role: string; storeId: string | null }, row: Row): boolean {
  if (actor.role === "ADMIN") return true;
  if (actor.role === "MANAGER") return row.role !== "ADMIN" && row.storeId === actor.storeId;
  return row.createdById === actor.id; // CASHIER: only what they created
}

export async function GET() {
  try {
    const actor = await requireScopedUser();

    let where: Prisma.UserWhereInput;
    if (actor.role === "ADMIN") {
      where = {};
    } else if (actor.role === "MANAGER") {
      where = { storeId: actor.storeId ?? "__none__" };
    } else {
      where = { OR: [{ createdById: actor.id }, { id: actor.id }] };
    }

    const rows = await prisma.user.findMany({
      where,
      orderBy: { createdAt: "asc" },
      select: { ...userSelect, _count: { select: { sales: true } } },
    });

    const users = rows.map((u) => ({ ...u, editable: canEdit(actor, u) }));
    return ok({ users });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const body = userCreateSchema.parse(await req.json());

    let role = body.role;
    let storeId = body.storeId ?? null;

    if (actor.role === "CASHIER") {
      if (!actor.storeId) throw new HttpError(403, "You aren't assigned to a store");
      role = "CASHIER";
      storeId = actor.storeId;
    } else if (actor.role === "MANAGER") {
      if (role === "ADMIN") throw new HttpError(403, "Managers cannot create admin accounts");
      if (!actor.storeId) throw new HttpError(403, "You aren't assigned to a store");
      storeId = actor.storeId;
    }
    // ADMIN: role and store as given.

    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        name: body.name,
        role,
        passwordHash: await hashPassword(body.password),
        storeId,
        createdById: actor.id,
      },
      select: userSelect,
    });
    return ok({ user: { ...user, editable: true } }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
