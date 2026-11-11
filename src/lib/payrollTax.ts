// Payroll tax math for a Tennessee employer, biweekly (26 pay periods a year).
//
// Tennessee has no wage income tax, so employees only have FEDERAL taxes
// withheld: income tax (IRS Pub. 15-T percentage method, Worksheet 1A, for a
// 2020-or-later Form W-4), Social Security and Medicare. The employer also owes
// matching Social Security / Medicare, federal unemployment (FUTA) and
// Tennessee unemployment (SUTA).
//
// All money is integer cents. The yearly constants below come from IRS
// Pub. 15-T (2026) and Pub. 15; add a new entry to TAX_YEARS each January.
// These are estimates to help run payroll — confirm against your accountant /
// the IRS before filing.

export const PAY_PERIODS_PER_YEAR = 26;

export type FilingStatus = "SINGLE" | "MFJ" | "HOH";
export type PayType = "HOURLY" | "SALARY";

type Bracket = { over: number; base: number; rate: number }; // dollars

type YearTables = {
  year: number;
  ssRate: number;
  ssWageBaseCents: number;
  medicareRate: number;
  addlMedicareRate: number;
  addlMedicareThresholdCents: number;
  /** Worksheet 1A line 1(g): added to the annual deduction when W-4 Step 2 is NOT checked. */
  standardAdjustmentCents: { MFJ: number; OTHER: number };
  /** Annual withholding rate schedules (dollars). */
  standard: Record<FilingStatus, Bracket[]>;
  /** The same, for a W-4 with the Step 2 checkbox ticked. */
  step2: Record<FilingStatus, Bracket[]>;
};

const TAX_YEARS: Record<number, YearTables> = {
  2026: {
    year: 2026,
    ssRate: 0.062,
    ssWageBaseCents: 184_500_00,
    medicareRate: 0.0145,
    addlMedicareRate: 0.009,
    addlMedicareThresholdCents: 200_000_00,
    standardAdjustmentCents: { MFJ: 12_900_00, OTHER: 8_600_00 },
    standard: {
      MFJ: [
        { over: 0, base: 0, rate: 0 },
        { over: 19_300, base: 0, rate: 0.1 },
        { over: 44_100, base: 2_480, rate: 0.12 },
        { over: 120_100, base: 11_600, rate: 0.22 },
        { over: 230_700, base: 35_932, rate: 0.24 },
        { over: 422_850, base: 82_048, rate: 0.32 },
        { over: 531_750, base: 116_896, rate: 0.35 },
        { over: 788_000, base: 206_583.5, rate: 0.37 },
      ],
      SINGLE: [
        { over: 0, base: 0, rate: 0 },
        { over: 7_500, base: 0, rate: 0.1 },
        { over: 19_900, base: 1_240, rate: 0.12 },
        { over: 57_900, base: 5_800, rate: 0.22 },
        { over: 113_200, base: 17_966, rate: 0.24 },
        { over: 209_275, base: 41_024, rate: 0.32 },
        { over: 263_725, base: 58_448, rate: 0.35 },
        { over: 648_100, base: 192_979.25, rate: 0.37 },
      ],
      HOH: [
        { over: 0, base: 0, rate: 0 },
        { over: 15_550, base: 0, rate: 0.1 },
        { over: 33_250, base: 1_770, rate: 0.12 },
        { over: 83_000, base: 7_740, rate: 0.22 },
        { over: 121_250, base: 16_155, rate: 0.24 },
        { over: 217_300, base: 39_207, rate: 0.32 },
        { over: 271_750, base: 56_631, rate: 0.35 },
        { over: 656_150, base: 191_171, rate: 0.37 },
      ],
    },
    step2: {
      MFJ: [
        { over: 0, base: 0, rate: 0 },
        { over: 16_100, base: 0, rate: 0.1 },
        { over: 28_500, base: 1_240, rate: 0.12 },
        { over: 66_500, base: 5_800, rate: 0.22 },
        { over: 121_800, base: 17_966, rate: 0.24 },
        { over: 217_875, base: 41_024, rate: 0.32 },
        { over: 272_325, base: 58_448, rate: 0.35 },
        { over: 400_450, base: 103_291.75, rate: 0.37 },
      ],
      SINGLE: [
        { over: 0, base: 0, rate: 0 },
        { over: 8_050, base: 0, rate: 0.1 },
        { over: 14_250, base: 620, rate: 0.12 },
        { over: 33_250, base: 2_900, rate: 0.22 },
        { over: 60_900, base: 8_983, rate: 0.24 },
        { over: 108_938, base: 20_512, rate: 0.32 },
        { over: 136_163, base: 29_224, rate: 0.35 },
        { over: 328_350, base: 96_489.63, rate: 0.37 },
      ],
      HOH: [
        { over: 0, base: 0, rate: 0 },
        { over: 12_075, base: 0, rate: 0.1 },
        { over: 20_925, base: 885, rate: 0.12 },
        { over: 45_800, base: 3_870, rate: 0.22 },
        { over: 64_925, base: 8_077.5, rate: 0.24 },
        { over: 112_950, base: 19_603.5, rate: 0.32 },
        { over: 140_175, base: 28_315.5, rate: 0.35 },
        { over: 332_375, base: 95_585.5, rate: 0.37 },
      ],
    },
  },
};

export function taxYearTables(year: number): YearTables | null {
  return TAX_YEARS[year] ?? null;
}

export type W4Info = {
  filingStatus: FilingStatus;
  w4Step2Checked: boolean;
  w4CreditsCents: number; // Step 3, per year
  w4OtherIncomeCents: number; // Step 4(a), per year
  w4DeductionsCents: number; // Step 4(b), per year
  w4ExtraWithholdingCents: number; // Step 4(c), per pay period
};

function tentativeAnnualTax(adjustedAnnualDollars: number, schedule: Bracket[]): number {
  let row = schedule[0];
  for (const b of schedule) if (adjustedAnnualDollars >= b.over) row = b;
  return row.base + (adjustedAnnualDollars - row.over) * row.rate;
}

/** Federal income tax to withhold from one biweekly paycheck (Pub. 15-T Worksheet 1A). */
export function federalWithholdingCents(grossCents: number, w4: W4Info, t: YearTables): number {
  if (grossCents <= 0) return 0;
  const annualWages = grossCents * PAY_PERIODS_PER_YEAR + w4.w4OtherIncomeCents; // 1c + 1d
  const adjustment = w4.w4Step2Checked
    ? 0
    : w4.filingStatus === "MFJ"
      ? t.standardAdjustmentCents.MFJ
      : t.standardAdjustmentCents.OTHER; // 1g
  const adjustedAnnualCents = Math.max(0, annualWages - (w4.w4DeductionsCents + adjustment)); // 1i
  const schedule = (w4.w4Step2Checked ? t.step2 : t.standard)[w4.filingStatus];
  const annualTaxDollars = tentativeAnnualTax(adjustedAnnualCents / 100, schedule); // 2
  const perPeriodCents = (annualTaxDollars * 100) / PAY_PERIODS_PER_YEAR; // 2h
  const afterCredits = Math.max(0, perPeriodCents - w4.w4CreditsCents / PAY_PERIODS_PER_YEAR); // 3c
  return Math.round(afterCredits + w4.w4ExtraWithholdingCents); // 4b
}

export type PayrollSettingsLite = {
  sutaRateBps: number;
  sutaWageBaseCents: number;
  futaRateBps: number;
  futaWageBaseCents: number;
};

/** What an employee has already been paid this calendar year, before this check. */
export type Ytd = { grossCents: number };

export type PayInput = {
  payType: PayType;
  hourlyRateCents: number;
  annualSalaryCents: number;
  regularHoursX100: number;
  overtimeHoursX100: number;
};

export type EntryResult = {
  rateCents: number;
  grossCents: number;
  fedWithholdingCents: number;
  ssEmployeeCents: number;
  medicareEmployeeCents: number;
  addlMedicareCents: number;
  netPayCents: number;
  ssEmployerCents: number;
  medicareEmployerCents: number;
  futaCents: number;
  sutaCents: number;
};

export function grossPayCents(p: PayInput): { rateCents: number; grossCents: number } {
  if (p.payType === "SALARY") {
    const per = Math.round(p.annualSalaryCents / PAY_PERIODS_PER_YEAR);
    return { rateCents: per, grossCents: per };
  }
  const regular = (p.regularHoursX100 * p.hourlyRateCents) / 100;
  const overtime = (p.overtimeHoursX100 * p.hourlyRateCents * 1.5) / 100;
  return { rateCents: p.hourlyRateCents, grossCents: Math.round(regular + overtime) };
}

export function computeEntry(
  pay: PayInput,
  w4: W4Info,
  ytd: Ytd,
  settings: PayrollSettingsLite,
  t: YearTables,
): EntryResult {
  const { rateCents, grossCents } = grossPayCents(pay);

  const ssTaxable = Math.max(0, Math.min(grossCents, t.ssWageBaseCents - ytd.grossCents));
  const ssEmployeeCents = Math.round(ssTaxable * t.ssRate);
  const medicareEmployeeCents = Math.round(grossCents * t.medicareRate);
  const addlTaxable = Math.max(
    0,
    Math.min(grossCents, ytd.grossCents + grossCents - t.addlMedicareThresholdCents),
  );
  const addlMedicareCents = Math.round(addlTaxable * t.addlMedicareRate);
  const fedWithholdingCents = Math.min(
    federalWithholdingCents(grossCents, w4, t),
    Math.max(0, grossCents - ssEmployeeCents - medicareEmployeeCents - addlMedicareCents),
  );

  const futaTaxable = Math.max(0, Math.min(grossCents, settings.futaWageBaseCents - ytd.grossCents));
  const sutaTaxable = Math.max(0, Math.min(grossCents, settings.sutaWageBaseCents - ytd.grossCents));

  return {
    rateCents,
    grossCents,
    fedWithholdingCents,
    ssEmployeeCents,
    medicareEmployeeCents,
    addlMedicareCents,
    netPayCents: grossCents - fedWithholdingCents - ssEmployeeCents - medicareEmployeeCents - addlMedicareCents,
    ssEmployerCents: ssEmployeeCents,
    medicareEmployerCents: medicareEmployeeCents,
    futaCents: Math.round((futaTaxable * settings.futaRateBps) / 10_000),
    sutaCents: Math.round((sutaTaxable * settings.sutaRateBps) / 10_000),
  };
}

/** Calendar quarter (1-4) of a date. */
export function quarterOf(d: Date): number {
  return Math.floor(d.getUTCMonth() / 3) + 1;
}
