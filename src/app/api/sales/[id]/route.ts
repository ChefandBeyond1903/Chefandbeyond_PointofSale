import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireUser();
    const { id } = await params;
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        items: true,
        cashier: { select: { id: true, name: true } },
      },
    });
    if (!sale) throw new HttpError(404, "Sale not found");
    return ok({ sale });
  } catch (err) {
    return toErrorResponse(err);
  }
}
