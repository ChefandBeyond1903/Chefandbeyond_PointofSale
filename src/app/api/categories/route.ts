import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireRole } from "@/lib/auth";
import { categoryCreateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET() {
  try {
    await requireUser();
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    });
    return ok({ categories });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole("MANAGER");
    const body = categoryCreateSchema.parse(await req.json());
    const category = await prisma.category.create({ data: { name: body.name } });
    return ok({ category }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
