import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, HttpError } from "@/lib/auth";
import { customerUpdateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const { id } = await params;
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        _count: { select: { sales: true } },
        sales: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, number: true, totalCents: true, createdAt: true },
        },
      },
    });
    if (!customer) throw new HttpError(404, "Customer not found");
    return ok({ customer });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const { id } = await params;
    const data = customerUpdateSchema.parse(await req.json());
    const customer = await prisma.customer.update({ where: { id }, data });
    return ok({ customer });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const { id } = await params;
    // Past sales keep their customer snapshot; only the directory link clears.
    await prisma.customer.delete({ where: { id } });
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
