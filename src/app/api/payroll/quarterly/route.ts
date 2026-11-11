import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { ok, toErrorResponse } from "@/lib/api";

// What's owed to the government for one calendar quarter (by pay date).
//  - Form 941 (federal deposit): income tax withheld + Social Security and
//    Medicare, both the employee's withheld share and the employer's match.
//  - FUTA (Form 940): the employer's federal unemployment.
//  - TN unemployment (SUTA): the employer's state unemployment.
export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMIN");
    const sp = new URL(req.url).searchParams;
    const year = parseInt(sp.get("year") ?? "", 10) || new Date().getUTCFullYear();
    const quarter = Math.min(4, Math.max(1, parseInt(sp.get("quarter") ?? "", 10) || 1));
    const from = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
    const to = new Date(Date.UTC(year, quarter * 3, 1));

    const entries = await prisma.payrollEntry.findMany({
      where: { run: { payDate: { gte: from, lt: to } } },
    });

    const sum = (f: (e: (typeof entries)[number]) => number) => entries.reduce((s, e) => s + f(e), 0);
    const totals = {
      employeeCount: new Set(entries.map((e) => e.employeeId)).size,
      checkCount: entries.length,
      grossCents: sum((e) => e.grossCents),
      fedWithholdingCents: sum((e) => e.fedWithholdingCents),
      ssEmployeeCents: sum((e) => e.ssEmployeeCents),
      ssEmployerCents: sum((e) => e.ssEmployerCents),
      medicareEmployeeCents: sum((e) => e.medicareEmployeeCents),
      medicareEmployerCents: sum((e) => e.medicareEmployerCents),
      addlMedicareCents: sum((e) => e.addlMedicareCents),
      futaCents: sum((e) => e.futaCents),
      sutaCents: sum((e) => e.sutaCents),
      netPayCents: sum((e) => e.netPayCents),
    };
    const employeeWithheldCents =
      totals.fedWithholdingCents +
      totals.ssEmployeeCents +
      totals.medicareEmployeeCents +
      totals.addlMedicareCents;
    const employerShareCents =
      totals.ssEmployerCents + totals.medicareEmployerCents + totals.futaCents + totals.sutaCents;
    const form941Cents =
      totals.fedWithholdingCents +
      totals.ssEmployeeCents +
      totals.ssEmployerCents +
      totals.medicareEmployeeCents +
      totals.medicareEmployerCents +
      totals.addlMedicareCents;

    const byEmp = new Map<
      string,
      {
        name: string;
        grossCents: number;
        fedWithholdingCents: number;
        ficaEmployeeCents: number;
        employerCents: number;
      }
    >();
    for (const e of entries) {
      const r = byEmp.get(e.employeeId) ?? {
        name: e.nameSnapshot,
        grossCents: 0,
        fedWithholdingCents: 0,
        ficaEmployeeCents: 0,
        employerCents: 0,
      };
      r.grossCents += e.grossCents;
      r.fedWithholdingCents += e.fedWithholdingCents;
      r.ficaEmployeeCents += e.ssEmployeeCents + e.medicareEmployeeCents + e.addlMedicareCents;
      r.employerCents += e.ssEmployerCents + e.medicareEmployerCents + e.futaCents + e.sutaCents;
      byEmp.set(e.employeeId, r);
    }

    return ok({
      year,
      quarter,
      totals,
      employeeWithheldCents,
      employerShareCents,
      form941Cents,
      totalCostCents: totals.grossCents + employerShareCents,
      employees: [...byEmp.entries()].map(([employeeId, r]) => ({ employeeId, ...r })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
