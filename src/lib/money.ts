// All monetary values in CB_POS are integer cents. Never use floats for money math.

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rem = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${rem}`;
}

/** Parse a user-entered dollar string ("12.5", "$12.50", "") into integer cents. */
export function parseMoney(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === "") return 0;
  if (typeof input === "number") return Math.round(input * 100);
  const cleaned = input.replace(/[^0-9.-]/g, "");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/**
 * Card-processing fee charged back to the business on card sales. Applied to the
 * full ticket total and shown as an expense line on the P&L. 300 bps = 3%.
 */
export const CARD_FEE_BPS = 300;
export const CARD_FEE_LABEL = "Credit card fees (3%)";

/** The card fee owed on a ticket total (cents), rounded half-up. */
export function cardFeeCents(totalCents: number): number {
  return Math.round((totalCents * CARD_FEE_BPS) / 10000);
}

/** Basis points (800 = 8.00%) applied to a cents amount, rounded half-up. */
export function taxOn(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10000);
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function parseBps(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === "") return 0;
  const value = typeof input === "number" ? input : Number.parseFloat(input.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}
