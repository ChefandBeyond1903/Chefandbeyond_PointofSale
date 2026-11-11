import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { settingsSchema } from "@/lib/payrollSchemas";
import { loadPayrollSettings } from "@/lib/payrollRun";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET() {
  try {
    await requireRole("ADMIN");
    return ok({ settings: await loadPayrollSettings() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireRole("ADMIN");
    const data = settingsSchema.parse(await req.json());
    const settings = await prisma.payrollSettings.upsert({
      where: { id: "payroll" },
      create: { id: "payroll", ...data },
      update: data,
    });
    return ok({ settings });
  } catch (err) {
    return toErrorResponse(err);
  }
}
