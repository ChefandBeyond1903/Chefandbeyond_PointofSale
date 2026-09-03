import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireRole } from "@/lib/auth";
import { customerCreateSchema } from "@/lib/validation";
import { parseDateInput } from "@/lib/date";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase();

    const all = await prisma.customer.findMany({
      orderBy: { name: "asc" },
      take: 1000,
      include: { _count: { select: { sales: true } } },
    });

    // Case-insensitive match against every stored field.
    const customers = q
      ? all.filter((c) =>
          [c.name, c.email, c.phone, c.company, c.address, c.notes].some((v) =>
            v.toLowerCase().includes(q),
          ),
        )
      : all;

    return ok({ customers });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const { taxExemptExpiresAt, ...data } = customerCreateSchema.parse(await req.json());
    const customer = await prisma.customer.create({
      data: { ...data, taxExemptExpiresAt: taxExemptExpiresAt ? parseDateInput(taxExemptExpiresAt) : null },
    });
    return ok({ customer }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
