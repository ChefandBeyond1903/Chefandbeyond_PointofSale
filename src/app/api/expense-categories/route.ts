import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireRole } from "@/lib/auth";
import { expenseCategoryCreateSchema } from "@/lib/validation";
import { mergeExpenseCategories } from "@/lib/expenseCategories";
import { ok, toErrorResponse } from "@/lib/api";

// The expense-category picker: ready-made names plus any a manager has added.
export async function GET() {
  try {
    await requireUser();
    const custom = await prisma.expenseCategory.findMany({ select: { name: true } });
    return ok({ categories: mergeExpenseCategories(custom.map((c) => c.name)) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const { name } = expenseCategoryCreateSchema.parse(await req.json());
    // Upsert so re-adding an existing name is a no-op rather than a 409.
    await prisma.expenseCategory.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    const custom = await prisma.expenseCategory.findMany({ select: { name: true } });
    return ok({ categories: mergeExpenseCategories(custom.map((c) => c.name)) }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
