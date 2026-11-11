import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, requireRole } from "@/lib/auth";
import { employeeUpdateSchema } from "@/lib/payrollSchemas";
import { parseDateInput } from "@/lib/date";
import { supabaseAdmin } from "@/lib/supabase";
import { EMPLOYEE_DOCS_BUCKET } from "@/lib/storage";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireRole("ADMIN");
    const { id } = await params;
    const { hireDate, ...data } = employeeUpdateSchema.parse(await req.json());
    const employee = await prisma.employee.update({
      where: { id },
      data: {
        ...data,
        ...(hireDate !== undefined ? { hireDate: hireDate ? parseDateInput(hireDate) : null } : {}),
      },
      include: { documents: { orderBy: { createdAt: "desc" } } },
    });
    return ok({ employee });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// An employee who has been paid can't be deleted (their checks are payroll
// history) — mark them inactive instead. One with no pay history is removed,
// along with their documents.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireRole("ADMIN");
    const { id } = await params;
    const paid = await prisma.payrollEntry.count({ where: { employeeId: id } });
    if (paid > 0) {
      throw new HttpError(400, "This employee has pay history — mark them inactive instead of deleting.");
    }
    const docs = await prisma.employeeDocument.findMany({ where: { employeeId: id } });
    if (docs.length) {
      await supabaseAdmin().storage.from(EMPLOYEE_DOCS_BUCKET).remove(docs.map((d) => d.storagePath));
    }
    await prisma.employee.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
