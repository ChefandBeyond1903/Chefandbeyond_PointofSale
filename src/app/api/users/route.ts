import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { hashPassword } from "@/lib/auth";
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
} as const;

export async function GET() {
  try {
    await requireRole("MANAGER");
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { ...userSelect, _count: { select: { sales: true } } },
    });
    return ok({ users });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole("MANAGER");
    const body = userCreateSchema.parse(await req.json());
    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        name: body.name,
        role: body.role,
        passwordHash: await hashPassword(body.password),
        storeId: body.storeId ?? null,
      },
      select: userSelect,
    });
    return ok({ user }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
