import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { recurringExpenseUpdateSchema } from "@/lib/validation";
import { parseDateInput } from "@/lib/date";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

async function loadScoped(id: string, actor: Awaited<ReturnType<typeof requireScopedRole>>) {
  const row = await prisma.recurringExpense.findUnique({
    where: { id },
    select: { id: true, storeId: true },
  });
  const scoped = scopeStoreId(actor);
  if (!row || (scoped && row.storeId !== scoped)) {
    throw new HttpError(404, "Recurring expense not found");
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    await loadScoped(id, actor);
    const f = recurringExpenseUpdateSchema.parse(await req.json());

    const data: Record<string, unknown> = {};
    if (f.category !== undefined) data.category = f.category;
    if (f.payee !== undefined) data.payee = f.payee;
    if (f.amountCents !== undefined) data.amountCents = f.amountCents;
    if (f.memo !== undefined) data.memo = f.memo;
    if (f.status !== undefined) data.status = f.status;
    if (f.frequency !== undefined) data.frequency = f.frequency;
    if (f.active !== undefined) data.active = f.active;
    if (f.nextDate !== undefined && f.nextDate) data.nextDate = parseDateInput(f.nextDate);
    if (f.storeId !== undefined && actor.role === "ADMIN") data.storeId = f.storeId || null;

    const recurring = await prisma.recurringExpense.update({ where: { id }, data });
    return ok({ recurring });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    await loadScoped(id, actor);
    await prisma.recurringExpense.delete({ where: { id } });
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
