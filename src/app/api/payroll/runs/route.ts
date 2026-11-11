import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { runSchema } from "@/lib/payrollSchemas";
import { computeRun } from "@/lib/payrollRun";
import { parseDateInput } from "@/lib/date";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET() {
  try {
    await requireRole("ADMIN");
    const runs = await prisma.payrollRun.findMany({
      orderBy: { payDate: "desc" },
      include: { entries: true },
    });
    return ok({ runs });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Calculate (dryRun) or save a pay run. The server does all the tax math, so
// what you preview is exactly what gets saved.
export async function POST(req: NextRequest) {
  try {
    await requireRole("ADMIN");
    const body = runSchema.parse(await req.json());
    const { lines, payDate } = await computeRun(body.payDate, body.entries);
    if (body.dryRun) return ok({ lines });

    const run = await prisma.payrollRun.create({
      data: {
        periodStart: parseDateInput(body.periodStart),
        periodEnd: parseDateInput(body.periodEnd),
        payDate,
        note: body.note,
        entries: {
          create: lines.map((l) => ({
            employeeId: l.employeeId,
            nameSnapshot: l.name,
            payType: l.payType,
            rateCents: l.result.rateCents,
            regularHoursX100: l.regularHoursX100,
            overtimeHoursX100: l.overtimeHoursX100,
            grossCents: l.result.grossCents,
            fedWithholdingCents: l.result.fedWithholdingCents,
            ssEmployeeCents: l.result.ssEmployeeCents,
            medicareEmployeeCents: l.result.medicareEmployeeCents,
            addlMedicareCents: l.result.addlMedicareCents,
            netPayCents: l.result.netPayCents,
            ssEmployerCents: l.result.ssEmployerCents,
            medicareEmployerCents: l.result.medicareEmployerCents,
            futaCents: l.result.futaCents,
            sutaCents: l.result.sutaCents,
          })),
        },
      },
      include: { entries: true },
    });
    return ok({ run }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
