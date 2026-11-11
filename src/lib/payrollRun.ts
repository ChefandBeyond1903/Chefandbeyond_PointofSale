import "server-only";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { parseDateInput } from "@/lib/date";
import {
  computeEntry,
  taxYearTables,
  type EntryResult,
  type FilingStatus,
  type PayType,
} from "@/lib/payrollTax";

export async function loadPayrollSettings() {
  return (
    (await prisma.payrollSettings.findUnique({ where: { id: "payroll" } })) ?? {
      id: "payroll",
      sutaRateBps: 270,
      sutaWageBaseCents: 700_000,
      futaRateBps: 60,
      futaWageBaseCents: 700_000,
      employerEin: "",
      updatedAt: new Date(),
    }
  );
}

export type RunLine = {
  employeeId: string;
  name: string;
  payType: PayType;
  regularHoursX100: number;
  overtimeHoursX100: number;
  result: EntryResult;
};

/**
 * Compute every paycheck for a run. Year-to-date wages (for the Social Security,
 * unemployment and Additional Medicare caps) come from the employee's earlier
 * checks in the same calendar year; `excludeRunId` leaves out the run being
 * recalculated.
 */
export async function computeRun(
  payDateStr: string,
  entries: { employeeId: string; regularHours: number; overtimeHours: number }[],
  excludeRunId?: string,
): Promise<{ lines: RunLine[]; payDate: Date }> {
  const payDate = parseDateInput(payDateStr);
  const year = payDate.getUTCFullYear();
  const tables = taxYearTables(year);
  if (!tables) {
    throw new HttpError(400, `Payroll tax tables for ${year} aren't loaded yet — they're added each January.`);
  }
  const settings = await loadPayrollSettings();
  const yearStart = new Date(Date.UTC(year, 0, 1));

  const ids = entries.map((e) => e.employeeId);
  const [employees, prior] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: ids } } }),
    prisma.payrollEntry.groupBy({
      by: ["employeeId"],
      where: {
        employeeId: { in: ids },
        run: { payDate: { gte: yearStart, lt: payDate }, ...(excludeRunId ? { id: { not: excludeRunId } } : {}) },
      },
      _sum: { grossCents: true },
    }),
  ]);
  const ytdBy = new Map(prior.map((p) => [p.employeeId, p._sum.grossCents ?? 0]));

  const lines = entries.map((e) => {
    const emp = employees.find((x) => x.id === e.employeeId);
    if (!emp) throw new HttpError(400, "An employee on this run no longer exists.");
    const regularHoursX100 = Math.round(e.regularHours * 100);
    const overtimeHoursX100 = Math.round(e.overtimeHours * 100);
    const result = computeEntry(
      {
        payType: emp.payType as PayType,
        hourlyRateCents: emp.hourlyRateCents,
        annualSalaryCents: emp.annualSalaryCents,
        regularHoursX100,
        overtimeHoursX100,
      },
      {
        filingStatus: emp.filingStatus as FilingStatus,
        w4Step2Checked: emp.w4Step2Checked,
        w4CreditsCents: emp.w4CreditsCents,
        w4OtherIncomeCents: emp.w4OtherIncomeCents,
        w4DeductionsCents: emp.w4DeductionsCents,
        w4ExtraWithholdingCents: emp.w4ExtraWithholdingCents,
      },
      { grossCents: ytdBy.get(emp.id) ?? 0 },
      settings,
      tables,
    );
    return {
      employeeId: emp.id,
      name: `${emp.firstName} ${emp.lastName}`.trim(),
      payType: emp.payType as PayType,
      regularHoursX100,
      overtimeHoursX100,
      result,
    };
  });
  return { lines, payDate };
}
