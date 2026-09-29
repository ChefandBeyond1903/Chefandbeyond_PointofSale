import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { advanceRecurDate } from "@/lib/recur";
import { ok, toErrorResponse } from "@/lib/api";

// Post every recurring expense whose nextDate has arrived: create a real
// Expense row for each occurrence and roll nextDate forward. Catches up if a
// template is several periods overdue (capped so it can't run away).
//
// Whether each occurrence posts as Paid or Unpaid is chosen per template by
// the caller (the Bills page shows a checklist before posting) — not every
// due bill has actually been paid yet just because it's due. Falls back to
// the template's own saved default status for any id not named.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const scoped = scopeStoreId(actor);
    const now = new Date();

    let statuses: Record<string, "PAID" | "UNPAID"> = {};
    try {
      const body = (await req.json()) as { statuses?: Record<string, "PAID" | "UNPAID"> };
      if (body?.statuses && typeof body.statuses === "object") statuses = body.statuses;
    } catch {
      /* no body sent — every occurrence falls back to its template's default status */
    }

    const due = await prisma.recurringExpense.findMany({
      where: { active: true, nextDate: { lte: now }, ...(scoped ? { storeId: scoped } : {}) },
    });

    let posted = 0;
    for (const r of due) {
      const status = statuses[r.id] === "PAID" || statuses[r.id] === "UNPAID" ? statuses[r.id] : r.status;
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
              status,
              paymentMethod: r.paymentMethod,
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
