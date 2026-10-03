import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatBps, formatMoney } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";
import { toWinAnsi, wrapPdfText } from "@/lib/pdfText";
import { INVOICE_LOGO_PNG_BASE64, INVOICE_LOGO_ASPECT } from "@/lib/invoiceLogo";

// Invoice / receipt PDF for emailing to the customer. Same content as the
// printed receipt (components/ReceiptModal.tsx ReceiptBody), laid out on US
// Letter like the web store's order PDF. pdf-lib is pure JS so this runs
// inside the Vercel serverless function.

// Keep in sync with INVOICE_FINE_PRINT in components/ReceiptModal.tsx.
export const INVOICE_FINE_PRINT =
  "ALL SALES ARE FINAL. Changes after 48 hours may incur a fee (refund subject to a " +
  "restocking fee of 30% of the total purchase price or more depends on the vendor). " +
  "Installation, electrical, roofing, ducting, construction, permits, stainless steel panels, " +
  "shrouds, duct enclosures, fire wrap, fire system connection, and testing are NOT INCLUDED " +
  "unless stated in writing. Buyer must comply with local regulations. Seller is not liable for " +
  "indirect damages. Tennessee laws apply. A 3% fee applies to refunds issued back to a credit " +
  "card.";

const GREEN = rgb(0x3c / 255, 0x85 / 255, 0x27 / 255);
const INK = rgb(0x1f / 255, 0x26 / 255, 0x2b / 255);
const MUTED = rgb(0.45, 0.49, 0.52);
const LINE = rgb(0.88, 0.9, 0.91);

export type InvoicePdfSale = {
  number: number;
  websiteOrderNumber?: string | null;
  status: string;
  createdAt: Date | string;
  subtotalCents: number;
  listSubtotalCents: number;
  discountCents: number;
  taxCents: number;
  taxRateBps: number;
  shippingCents: number;
  totalCents: number;
  paymentMethod: string;
  checkNumber?: string | null;
  tenderedCents: number;
  changeCents: number;
  amountPaidCents: number;
  note?: string | null;
  termsSnapshot?: string | null;
  dueDate?: Date | string | null;
  customerTaxExemptSnapshot?: boolean;
  storeNameSnapshot?: string | null;
  storeAddressSnapshot?: string | null;
  storePhoneSnapshot?: string | null;
  storeEmailSnapshot?: string | null;
  customerNameSnapshot?: string | null;
  customerCompanySnapshot?: string | null;
  customerEmailSnapshot?: string | null;
  customerPhoneSnapshot?: string | null;
  customerAddressSnapshot?: string | null;
  customerLocationSnapshot?: string | null;
  salesperson?: { name: string } | null;
  items: {
    nameSnapshot: string;
    skuSnapshot?: string | null;
    serialNumber?: string | null;
    quantity: number;
    unitPriceCents: number;
  }[];
  payments?: {
    method: string;
    amountCents: number;
    paidAt: Date | string;
    checkNumber?: string | null;
    cardBrand?: string | null;
    cardLast4?: string | null;
    isDeposit?: boolean;
  }[];
};

export type InvoicePdfCompany = {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
} | null;

const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString());

/** "Invoice #1042" or "Receipt #1042" — invoice while money is still owed. */
export function invoiceLabel(sale: Pick<InvoicePdfSale, "number" | "websiteOrderNumber" | "status" | "amountPaidCents" | "totalCents">): string {
  const ref = sale.websiteOrderNumber || `#${sale.number}`;
  const owing = sale.status === "INVOICED" && (sale.amountPaidCents ?? 0) < sale.totalCents;
  return `${owing ? "Invoice" : "Receipt"} ${ref}`;
}

export function balanceDueCents(sale: Pick<InvoicePdfSale, "status" | "amountPaidCents" | "totalCents">): number {
  if (sale.status !== "INVOICED") return 0;
  return Math.max(0, sale.totalCents - (sale.amountPaidCents ?? 0));
}

function paymentLabel(p: NonNullable<InvoicePdfSale["payments"]>[number]): string {
  if (p.method === "CARD" && p.cardLast4) return `${p.cardBrand || "Card"} ending ${p.cardLast4}`;
  if (p.method === "CHECK" && p.checkNumber) return `Check #${p.checkNumber}`;
  if (p.method === "CREDIT") return "Store credit";
  return p.method.charAt(0) + p.method.slice(1).toLowerCase();
}

export async function buildInvoicePdf(sale: InvoicePdfSale, company: InvoicePdfCompany): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const logo = await doc.embedPng(Buffer.from(INVOICE_LOGO_PNG_BASE64, "base64")).catch(() => null);

  const PAGE_W = 612;
  const PAGE_H = 792; // US Letter
  const M = 54;
  const W = PAGE_W - M * 2;
  const TOP = PAGE_H - 64;
  const BOTTOM = 72;

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = TOP;

  const text = (
    raw: string,
    x: number,
    size: number,
    opts: { font?: PDFFont; color?: ReturnType<typeof rgb>; right?: boolean } = {},
  ) => {
    const s = toWinAnsi(raw);
    const font = opts.font ?? reg;
    const drawX = opts.right ? x - font.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: drawX, y, size, font, color: opts.color ?? INK });
  };
  const rule = (thickness = 0.5, color = LINE) =>
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness, color });
  const ensure = (needed: number) => {
    if (y - needed >= BOTTOM) return;
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = TOP;
  };

  // ---- Header: logo (or wordmark) left, document title right -------------
  const label = invoiceLabel(sale);
  const title = label.split(" ")[0].toUpperCase(); // INVOICE / RECEIPT
  const ref = sale.websiteOrderNumber || `#${sale.number}`;
  if (logo) {
    const h = 34;
    const w = h * INVOICE_LOGO_ASPECT;
    page.drawImage(logo, { x: M, y: y - h + 10, width: w, height: h });
  } else {
    text("CHEF AND BEYOND", M, 20, { font: bold, color: GREEN });
  }
  text(title, M + W, 18, { font: bold, right: true });
  y -= 16;
  text(`Sale ${ref}`, M + W, 10, { font: bold, right: true });
  y -= 13;
  const created = new Date(iso(sale.createdAt));
  text(
    created.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }),
    M + W,
    9,
    { color: MUTED, right: true },
  );
  y -= 19;
  rule(1.5, GREEN);
  y -= 20;

  // ---- From / Bill to -----------------------------------------------------
  const storeName = sale.storeNameSnapshot || company?.name || "Chef and Beyond";
  const storeAddr = sale.storeAddressSnapshot || company?.address || "";
  const storePhone = sale.storePhoneSnapshot || company?.phone || "";
  const storeEmail = sale.storeEmailSnapshot || company?.email || "";
  const colY = y;
  const half = M + W / 2 + 10;
  const colW = W / 2 - 20;

  text("FROM", M, 8, { font: bold, color: MUTED });
  y -= 13;
  text(storeName, M, 10, { font: bold });
  y -= 12;
  for (const ln of [storeAddr, [storePhone, storeEmail].filter(Boolean).join(" · "), company?.website ?? ""]) {
    if (!ln) continue;
    for (const w of wrapPdfText(ln, reg, 9, colW)) {
      text(w, M, 9);
      y -= 12;
    }
  }
  if (sale.salesperson?.name) {
    text(`Served by ${sale.salesperson.name}`, M, 9, { color: MUTED });
    y -= 12;
  }
  const leftEnd = y;

  y = colY;
  text("BILL TO", half, 8, { font: bold, color: MUTED });
  y -= 13;
  const custCompany = sale.customerCompanySnapshot || "";
  const custName = sale.customerNameSnapshot || "";
  const headline = custCompany && custName && custName !== custCompany ? `${custCompany} — ${custName}` : custCompany || custName || "Walk-in customer";
  for (const w of wrapPdfText(headline, bold, 9.5, colW)) {
    text(w, half, 9.5, { font: bold });
    y -= 12;
  }
  if (sale.customerLocationSnapshot) {
    text(sale.customerLocationSnapshot, half, 9, { color: MUTED });
    y -= 12;
  }
  for (const ln of [sale.customerAddressSnapshot, sale.customerEmailSnapshot, sale.customerPhoneSnapshot]) {
    if (!ln) continue;
    for (const w of wrapPdfText(ln, reg, 9, colW)) {
      text(w, half, 9);
      y -= 12;
    }
  }
  if (sale.termsSnapshot || sale.dueDate) {
    text(
      [sale.termsSnapshot ? `Terms ${sale.termsSnapshot}` : "", sale.dueDate ? `Due ${formatDateOnly(iso(sale.dueDate))}` : ""]
        .filter(Boolean)
        .join(" · "),
      half,
      9,
      { font: bold },
    );
    y -= 12;
  }
  if (sale.customerTaxExemptSnapshot) {
    text("Tax-exempt sale", half, 9, { color: GREEN, font: bold });
    y -= 12;
  }
  y = Math.min(leftEnd, y) - 10;

  if (sale.note) {
    ensure(40);
    for (const w of wrapPdfText(sale.note, reg, 9, W, 6)) {
      text(w, M, 9, { color: MUTED });
      y -= 12;
    }
    y -= 4;
  }
  y -= 10;

  // ---- Items --------------------------------------------------------------
  const COLS = { item: M, qty: M + W - 150, price: M + W - 80, total: M + W };
  const nameWidth = COLS.qty - M - 30;
  const head = () => {
    text("ITEM", COLS.item, 8, { font: bold, color: MUTED });
    text("QTY", COLS.qty, 8, { font: bold, color: MUTED, right: true });
    text("UNIT", COLS.price, 8, { font: bold, color: MUTED, right: true });
    text("TOTAL", COLS.total, 8, { font: bold, color: MUTED, right: true });
    y -= 6;
    rule();
    y -= 16;
  };
  ensure(60);
  head();
  for (const it of sale.items) {
    const nameLines = wrapPdfText(it.nameSnapshot, bold, 9.5, nameWidth, 3);
    const sub = [it.skuSnapshot ? `SKU ${it.skuSnapshot}` : "", it.serialNumber ? `S/N ${it.serialNumber}` : ""].filter(Boolean).join("   ");
    const rowH = 11 * (nameLines.length - 1) + (sub ? 11 : 0) + 17;
    if (y - rowH < BOTTOM) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = TOP;
      head();
    }
    text(nameLines[0], COLS.item, 9.5, { font: bold });
    text(String(it.quantity), COLS.qty, 9.5, { right: true });
    text(formatMoney(it.unitPriceCents), COLS.price, 9.5, { right: true });
    // Line total before discount and tax, so the column sums to Subtotal.
    text(formatMoney(it.unitPriceCents * it.quantity), COLS.total, 9.5, { font: bold, right: true });
    for (const extra of nameLines.slice(1)) {
      y -= 11;
      text(extra, COLS.item, 9.5, { font: bold });
    }
    if (sub) {
      y -= 11;
      text(sub, COLS.item, 7.5, { color: MUTED });
    }
    y -= 17;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: M + W, y: y + 6 }, thickness: 0.5, color: LINE });
  }

  // ---- Totals + payments (kept together with the footer) -----------------
  const payments = sale.payments ?? [];
  const owing = balanceDueCents(sale);
  const totalsRows = 5 + payments.length + 4;
  const finePrintLines = wrapPdfText(INVOICE_FINE_PRINT, reg, 7, W, Infinity);
  ensure(totalsRows * 15 + 40 + finePrintLines.length * 9 + 40);
  y -= 8;
  const row = (k: string, v: string, opts: { big?: boolean; green?: boolean; muted?: boolean } = {}) => {
    text(k, COLS.price, opts.big ? 11 : 9.5, {
      font: opts.big ? bold : reg,
      color: opts.green ? GREEN : opts.big ? INK : MUTED,
      right: true,
    });
    text(v, COLS.total, opts.big ? 12 : 9.5, { font: opts.muted ? reg : bold, color: opts.green ? GREEN : INK, right: true });
    y -= opts.big ? 20 : 15;
  };
  row("Subtotal", formatMoney(sale.subtotalCents));
  if (sale.discountCents !== 0) row("Discount", `-${formatMoney(sale.discountCents)}`, { green: true });
  row(
    sale.customerTaxExemptSnapshot ? "Tax (exempt)" : `Tax${sale.taxRateBps ? ` (${formatBps(sale.taxRateBps)})` : ""}`,
    formatMoney(sale.taxCents),
  );
  if (sale.shippingCents > 0) row("Shipping", formatMoney(sale.shippingCents));
  row("Total", formatMoney(sale.totalCents), { big: true });

  if (payments.length) {
    for (const p of payments) {
      const when = new Date(iso(p.paidAt)).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "America/Chicago" });
      row(`${p.isDeposit ? "Deposit" : "Paid"} · ${paymentLabel(p)} · ${when}`, formatMoney(p.amountCents), { muted: true });
    }
  } else if (!owing) {
    const tender =
      sale.paymentMethod === "CHECK" && sale.checkNumber
        ? `Check #${sale.checkNumber}`
        : sale.paymentMethod === "SPLIT"
          ? "Paid (split tender)"
          : sale.paymentMethod
            ? `Paid · ${sale.paymentMethod.charAt(0)}${sale.paymentMethod.slice(1).toLowerCase()}`
            : "Paid";
    row(tender, formatMoney(sale.tenderedCents || sale.totalCents), { muted: true });
  }
  if (sale.changeCents > 0 && !owing) row("Change", formatMoney(sale.changeCents), { muted: true });
  if (owing > 0) {
    row("Balance due", formatMoney(owing), { big: true, green: false });
    if (sale.dueDate) row("Due by", formatDateOnly(iso(sale.dueDate)), { muted: true });
  } else {
    y -= 4;
    text("PAID IN FULL", COLS.total, 10, { font: bold, color: GREEN, right: true });
    y -= 15;
  }

  const listSub = sale.listSubtotalCents || sale.subtotalCents;
  const saved = listSub - (sale.subtotalCents - sale.discountCents);
  if (saved > 0) {
    text(
      `You saved ${formatMoney(saved)}${listSub > 0 ? ` (${Math.round((saved / listSub) * 100)}% off list)` : ""}`,
      COLS.total,
      9,
      { font: bold, color: GREEN, right: true },
    );
    y -= 15;
  }

  // ---- Footer -------------------------------------------------------------
  y -= 10;
  rule();
  y -= 14;
  text("Thank you for your business!", M, 9, { font: bold });
  y -= 14;
  for (const ln of finePrintLines) {
    text(ln, M, 7, { color: MUTED });
    y -= 9;
  }

  return doc.save();
}
