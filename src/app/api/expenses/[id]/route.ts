import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { expenseUpdateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

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

async function loadInScope(id: string, actor: Awaited<ReturnType<typeof requireScopedRole>>) {
  const row = await prisma.expense.findUnique({ where: { id }, select: { storeId: true } });
  const scoped = scopeStoreId(actor);
  if (!row || (scoped && row.storeId !== scoped)) {
    throw new HttpError(404, "Expense not found");
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    await loadInScope(id, actor);
    const f = expenseUpdateSchema.parse(await req.json());

    const data: Record<string, unknown> = {};
    if (f.category !== undefined) data.category = f.category;
    if (f.payee !== undefined) data.payee = f.payee;
    if (f.amountCents !== undefined) data.amountCents = f.amountCents;
    if (f.expenseDate !== undefined) data.expenseDate = new Date(f.expenseDate);
    if (f.memo !== undefined) data.memo = f.memo;
    if (f.status !== undefined) data.status = f.status;
    // Only an admin may move an expense between stores.
    if (f.storeId !== undefined && actor.role === "ADMIN") {
      data.storeId = f.storeId || null;
    }

    const expense = await prisma.expense.update({ where: { id }, data, select: expenseSelect });
    return ok({ expense });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    await loadInScope(id, actor);
    await prisma.expense.delete({ where: { id } });
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
