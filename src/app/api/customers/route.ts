import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScopedUser, requireScopedRole, scopeStoreId } from "@/lib/scope";
import { customerCreateSchema } from "@/lib/validation";
import { parseDateInput } from "@/lib/date";
import { phoneDigits } from "@/lib/phone";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase();
    // Digits of the query — matches a phone ignoring (), - and spaces.
    const qDigits = q ? phoneDigits(q) : "";

    // Non-admin staff only see the customers created at their own store.
    const scoped = scopeStoreId(actor);

    const all = await prisma.customer.findMany({
      where: scoped ? { storeId: scoped } : {},
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
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { taxExemptExpiresAt, ...data } = customerCreateSchema.parse(await req.json());
    const customer = await prisma.customer.create({
      data: {
        ...data,
        // Belongs to the creator's store; an admin with no store creates a
        // shared (null-store) customer.
        storeId: actor.storeId ?? null,
        taxExemptExpiresAt: taxExemptExpiresAt ? parseDateInput(taxExemptExpiresAt) : null,
      },
    });
    return ok({ customer }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
