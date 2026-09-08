import { prisma } from "@/lib/prisma";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { advanceRecurDate } from "@/lib/recur";
import { ok, toErrorResponse } from "@/lib/api";

// Post every recurring expense whose nextDate has arrived: create a real
// Expense row for each occurrence and roll nextDate forward. Catches up if a
// template is several periods overdue (capped so it can't run away).
export async function POST() {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const scoped = scopeStoreId(actor);
    const now = new Date();

    const due = await prisma.recurringExpense.findMany({
      where: { active: true, nextDate: { lte: now }, ...(scoped ? { storeId: scoped } : {}) },
    });

    let posted = 0;
    for (const r of due) {
      let next = r.nextDate;
      let guard = 0;
      await prisma.$transaction(async (tx) => {
        while (next <= now && guard < 60) {
          await tx.expense.create({
            data: {
              category: r.category,
              payee: r.payee,
              amountCents: r.amountCents,
              expenseDate: next,
              memo: r.memo,
              status: r.status,
              storeId: r.storeId,
              createdById: actor.id,
            },
          });
          posted += 1;
          next = advanceRecurDate(next, r.frequency);
          guard += 1;
        }
        await tx.recurringExpense.update({ where: { id: r.id }, data: { nextDate: next } });
      });
    }

    return ok({ posted, templates: due.length });
  } catch (err) {
    return toErrorResponse(err);
  }
}
