import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireRole } from "@/lib/auth";
import { storeCreateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const includeInactive = new URL(req.url).searchParams.get("all") === "1";
    const stores = await prisma.store.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
      include: { _count: { select: { users: true, sales: true } } },
    });
    return ok({ stores });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole("ADMIN");
    const data = storeCreateSchema.parse(await req.json());
    const store = await prisma.store.create({
      data,
      include: { _count: { select: { users: true, sales: true } } },
    });
    return ok({ store }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
