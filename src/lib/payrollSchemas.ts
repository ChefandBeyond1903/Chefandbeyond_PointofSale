import { z } from "zod";

const cents = z.number().int().min(0).max(100_000_000_00);

export const employeeSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().max(160).default(""),
  phone: z.string().trim().max(40).default(""),
  street: z.string().trim().max(200).default(""),
  city: z.string().trim().max(120).default(""),
  state: z.string().trim().max(2).default("TN"),
  zip: z.string().trim().max(12).default(""),
  ssnLast4: z.string().trim().regex(/^(\d{4})?$/, "Enter just the last 4 digits").default(""),
  hireDate: z.string().trim().optional().nullable(),
  active: z.boolean().default(true),
  notes: z.string().trim().max(1000).default(""),
  payType: z.enum(["HOURLY", "SALARY"]).default("HOURLY"),
  hourlyRateCents: cents.default(0),
  annualSalaryCents: cents.default(0),
  filingStatus: z.enum(["SINGLE", "MFJ", "HOH"]).default("SINGLE"),
  w4Step2Checked: z.boolean().default(false),
  w4CreditsCents: cents.default(0),
  w4OtherIncomeCents: cents.default(0),
  w4DeductionsCents: cents.default(0),
  w4ExtraWithholdingCents: cents.default(0),
});
export const employeeUpdateSchema = employeeSchema.partial();

export const settingsSchema = z.object({
  sutaRateBps: z.number().int().min(0).max(1500),
  sutaWageBaseCents: cents,
  futaRateBps: z.number().int().min(0).max(1000),
  futaWageBaseCents: cents,
  employerEin: z.string().trim().max(20).default(""),
});

export const runSchema = z.object({
  periodStart: z.string().min(8),
  periodEnd: z.string().min(8),
  payDate: z.string().min(8),
  note: z.string().trim().max(300).default(""),
  dryRun: z.boolean().default(false),
  entries: z
    .array(
      z.object({
        employeeId: z.string().min(1),
        regularHours: z.number().min(0).max(400).default(0),
        overtimeHours: z.number().min(0).max(200).default(0),
      }),
    )
    .min(1),
});
