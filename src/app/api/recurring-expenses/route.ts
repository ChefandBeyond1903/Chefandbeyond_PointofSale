import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireScopedUser, requireScopedRole, scopeStoreId } from "@/lib/scope";
import { recurringExpenseCreateSchema } from "@/lib/validation";
import { parseDateInput } from "@/lib/date";
import { ok, toErrorResponse } from "@/lib/api";

const select = {
  id: true,
  category: true,
  payee: true,
  amountCents: true,
  memo: true,
  status: true,
  frequency: true,
  nextDate: true,
  active: true,
  storeId: true,
  store: { select: { id: true, name: true } },
  createdAt: true,
} as const;

export async function GET() {
  try {
    const actor = await requireScopedUser();
    const scoped = scopeStoreId(actor);
    const where: Prisma.RecurringExpenseWhereInput = {};
    if (scoped) where.storeId = scoped;

    const recurring = await prisma.recurringExpense.findMany({
      where,
      orderBy: [{ active: "desc" }, { nextDate: "asc" }],
      select,
    });
    const now = new Date();
    const dueCount = recurring.filter((r) => r.active && r.nextDate <= now).length;
    return ok({ recurring, dueCount });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const f = recurringExpenseCreateSchema.parse(await req.json());
    const storeId = actor.role === "ADMIN" ? (f.storeId ?? null) : (actor.storeId ?? null);

    const recurring = await prisma.recurringExpense.create({
      data: {
        category: f.category,
        payee: f.payee,
        amountCents: f.amountCents,
        memo: f.memo,
        status: f.status,
        frequency: f.frequency,
        nextDate: parseDateInput(f.nextDate),
        storeId,
        createdById: actor.id,
      },
      select,
    });
    return ok({ recurring }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
