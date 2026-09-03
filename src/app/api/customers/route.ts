import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireRole } from "@/lib/auth";
import { customerCreateSchema } from "@/lib/validation";
import { parseDateInput } from "@/lib/date";
import { phoneDigits } from "@/lib/phone";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase();
    // Digits of the query — matches a phone ignoring (), - and spaces.
    const qDigits = q ? phoneDigits(q) : "";

    const all = await prisma.customer.findMany({
      orderBy: { name: "asc" },
      take: 1000,
      include: { _count: { select: { sales: true } } },
    });

    // Case-insensitive match against every stored field, plus a digits-only
    // match on the phone so "6158704844" or "4844" finds "(615)870-4844".
    const customers = q
      ? all.filter(
          (c) =>
            [c.name, c.email, c.phone, c.company, c.address, c.notes].some((v) =>
              v.toLowerCase().includes(q),
            ) ||
            (qDigits.length >= 2 && phoneDigits(c.phone).includes(qDigits)),
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
