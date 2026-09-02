import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireScopedUser, requireScopedRole, scopeStoreId } from "@/lib/scope";
import { expenseCreateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

const expenseSelect = {
  id: true,
  category: true,
  payee: true,
  amountCents: true,
  expenseDate: true,
  memo: true,
  status: true,
  storeId: true,
  store: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  createdAt: true,
} as const;

export async function GET(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status")?.trim();
    const storeParam = searchParams.get("storeId")?.trim();
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const where: Prisma.ExpenseWhereInput = {};
    const scoped = scopeStoreId(actor);
    if (scoped) where.storeId = scoped;
    else if (storeParam) where.storeId = storeParam;
    if (status === "PAID" || status === "UNPAID") where.status = status;
    if (from || to) {
      where.expenseDate = {};
      if (from) where.expenseDate.gte = new Date(from);
      if (to) where.expenseDate.lte = new Date(to);
    }

    const expenses = await prisma.expense.findMany({
      where,
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      take: 500,
      select: expenseSelect,
    });
    return ok({ expenses });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const f = expenseCreateSchema.parse(await req.json());

    // A manager's expenses belong to their own store; an admin may name one
    // (or leave it company-wide).
    const storeId =
      actor.role === "ADMIN" ? (f.storeId ?? null) : (actor.storeId ?? null);

    const expense = await prisma.expense.create({
      data: {
        category: f.category,
        payee: f.payee,
        amountCents: f.amountCents,
        expenseDate: f.expenseDate ? new Date(f.expenseDate) : new Date(),
        memo: f.memo,
        status: f.status,
        storeId,
        createdById: actor.id,
      },
      select: expenseSelect,
    });
    return ok({ expense }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
