import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { employeeSchema } from "@/lib/payrollSchemas";
import { parseDateInput } from "@/lib/date";
import { ok, toErrorResponse } from "@/lib/api";

// Payroll is admin-only: it holds wages and tax-withholding details.
export async function GET() {
  try {
    await requireRole("ADMIN");
    const employees = await prisma.employee.findMany({
      orderBy: [{ active: "desc" }, { lastName: "asc" }, { firstName: "asc" }],
      include: { documents: { orderBy: { createdAt: "desc" } } },
    });
    return ok({ employees });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole("ADMIN");
    const { hireDate, ...data } = employeeSchema.parse(await req.json());
    const employee = await prisma.employee.create({
      data: { ...data, hireDate: hireDate ? parseDateInput(hireDate) : null },
      include: { documents: true },
    });
    return ok({ employee }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
