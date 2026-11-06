import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatBps, formatMoney } from "@/lib/money";
import { INVOICE_FINE_PRINT } from "@/lib/invoiceFinePrint";
import { LOGO_PNG_BASE64, LOGO_ASPECT } from "@/lib/logoPng";
import {
  balanceDueCents,
  dateOnly,
  invoiceLabel,
  type EmailCompany,
  type EmailSale,
} from "@/lib/invoiceEmail";

const NAVY = rgb(0.122, 0.165, 0.235);
const GREEN = rgb(0.239, 0.545, 0.184);
const GRAY = rgb(0.42, 0.45, 0.5);
const LIGHT = rgb(0.93, 0.94, 0.96);
const INK = rgb(0.15, 0.19, 0.25);

// pdf-lib's built-in fonts only encode WinAnsi — swap anything outside it.
const clean = (s: string) =>
  s
    .replace(/[−–]/g, "-")
    .replace(/×/g, "x")
    .replace(/[^\x20-\x7E\xA0-\xFF—‘’“”•…]/g, "?");

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** A letter-size PDF of one invoice. Returns the raw bytes. */
export async function buildInvoicePdf(sale: EmailSale, company: EmailCompany): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));

  const W = 612;
  const H = 792;
  const M = 48;
  const right = W - M;
  let page!: PDFPage;
  let y = 0;

  const text = (t: string, x: number, size: number, f = font, color = INK) =>
    page.drawText(clean(t), { x, y, size, font: f, color });
  const textRight = (t: string, xr: number, size: number, f = font, color = INK) => {
    const c = clean(t);
    page.drawText(c, { x: xr - f.widthOfTextAtSize(c, size), y, size, font: f, color });
  };

  const newPage = (first = false) => {
    page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: GREEN });
    y = H - 44;
    if (first) return;
    text(`Invoice ${invoiceLabel(sale)} (continued)`, M, 10, bold, GRAY);
    y -= 26;
  };
  const ensure = (needed: number) => {
    if (y - needed < M + 20) newPage();
  };

  newPage(true);

  // Header: logo left, invoice title right.
  const logoW = 150;
  const logoH = logoW / LOGO_ASPECT;
  page.drawImage(logo, { x: M, y: y - logoH + 6, width: logoW, height: logoH });
  textRight("INVOICE", right, 24, bold, NAVY);
  y -= 20;
  textRight(invoiceLabel(sale), right, 12, font, GRAY);
  y -= 16;
  textRight(sale.createdAt.toLocaleDateString("en-US", { timeZone: "America/Chicago" }), right, 10, font, GRAY);
  y -= logoH - 22;

  // From / Bill to.
  y -= 14;
  const storeName = sale.storeNameSnapshot || company?.name || "Chef and Beyond";
  const address = sale.storeAddressSnapshot || company?.address || "";
  const phone = sale.storePhoneSnapshot || company?.phone || "";
  const topY = y;
  text(storeName, M, 10, bold, NAVY);
  y -= 13;
  for (const l of [address, phone, company?.email, company?.website].filter(Boolean) as string[]) {
    for (const w of wrap(l, font, 9, 230)) {
      text(w, M, 9, font, GRAY);
      y -= 12;
    }
  }
  const leftEnd = y;

  y = topY;
  const col = 330;
  text("BILL TO", col, 8, bold, GRAY);
  y -= 13;
  const billTo = [
    sale.customerCompanySnapshot || sale.customerNameSnapshot,
    sale.customerCompanySnapshot && sale.customerNameSnapshot !== sale.customerCompanySnapshot
      ? sale.customerNameSnapshot
      : "",
    sale.customerLocationSnapshot,
    sale.customerLocationSnapshot ? sale.customerAddressSnapshot : "",
  ].filter(Boolean);
  billTo.forEach((l, i) => {
    for (const w of wrap(l, i === 0 ? bold : font, 10, right - col)) {
      text(w, col, 10, i === 0 ? bold : font, i === 0 ? INK : GRAY);
      y -= 13;
    }
  });
  if (sale.dueDate) {
    y -= 2;
    text(`${sale.termsSnapshot ? `${sale.termsSnapshot} - ` : ""}Due ${dateOnly(sale.dueDate)}`, col, 10, bold, NAVY);
    y -= 13;
  }
  if (sale.customerTaxExemptSnapshot) {
    text("Tax-exempt sale", col, 9, font, GRAY);
    y -= 12;
  }
  y = Math.min(y, leftEnd) - 14;

  if (sale.note) {
    for (const w of wrap(sale.note, font, 9, right - M)) {
      ensure(12);
      text(w, M, 9, font, GRAY);
      y -= 12;
    }
    y -= 6;
  }

  // Items table.
  const qtyX = M + 6;
  const descX = M + 44;
  const amtR = right - 6;
  const drawHead = () => {
    page.drawRectangle({ x: M, y: y - 6, width: right - M, height: 22, color: LIGHT });
    text("QTY", qtyX, 8, bold, GRAY);
    text("DESCRIPTION", descX, 8, bold, GRAY);
    textRight("AMOUNT", amtR, 8, bold, GRAY);
    y -= 24;
  };
  ensure(60);
  drawHead();
  for (const it of sale.items) {
    const net = it.unitPriceCents * it.quantity - it.discountCents;
    const lines = wrap(it.nameSnapshot, font, 10, amtR - descX - 70);
    const subs: string[] = [];
    if (it.discountCents > 0) {
      subs.push(`${formatMoney(it.unitPriceCents)} each - discounted - ${formatMoney(it.discountCents)}`);
    }
    if (it.serialNumber) subs.push(`S/N: ${it.serialNumber}`);
    const h = lines.length * 13 + subs.length * 11 + 10;
    if (y - h < M + 20) {
      newPage();
      drawHead();
    }
    text(String(it.quantity), qtyX, 10);
    lines.forEach((l, i) => {
      page.drawText(l, { x: descX, y: y - i * 13, size: 10, font, color: INK });
    });
    textRight(formatMoney(net), amtR, 10, bold);
    y -= lines.length * 13;
    for (const s of subs) {
      text(s, descX, 8, font, GRAY);
      y -= 11;
    }
    y -= 4;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: right, y: y + 2 }, thickness: 0.5, color: LIGHT });
    y -= 8;
  }

  // Totals.
  const balance = balanceDueCents(sale);
  const paid = sale.amountPaidCents ?? 0;
  const tRows: [string, string, boolean][] = [["Subtotal", formatMoney(sale.subtotalCents), false]];
  if (sale.discountCents !== 0) tRows.push(["Discount", `- ${formatMoney(sale.discountCents)}`, false]);
  tRows.push([
    `Tax${sale.taxRateBps ? ` (${formatBps(sale.taxRateBps)})` : ""}`,
    formatMoney(sale.taxCents),
    false,
  ]);
  if (sale.shippingCents > 0) tRows.push(["Shipping", formatMoney(sale.shippingCents), false]);
  tRows.push(["Total", formatMoney(sale.totalCents), true]);
  if (sale.status === "INVOICED" && paid > 0) tRows.push(["Paid", `- ${formatMoney(paid)}`, false]);

  ensure(tRows.length * 16 + 70);
  y -= 6;
  const tx = 340;
  for (const [label, value, strong] of tRows) {
    text(label, tx, strong ? 11 : 10, strong ? bold : font, strong ? NAVY : GRAY);
    textRight(value, right - 6, strong ? 11 : 10, strong ? bold : font, strong ? NAVY : INK);
    y -= 16;
  }
  y -= 4;
  const owing = balance > 0;
  page.drawRectangle({ x: tx - 8, y: y - 12, width: right - tx + 8, height: 30, color: owing ? NAVY : GREEN });
  page.drawText(owing ? "BALANCE DUE" : "PAID IN FULL", {
    x: tx, y: y - 1, size: 10, font: bold, color: rgb(1, 1, 1),
  });
  textRight(formatMoney(balance), right - 6, 14, bold, rgb(1, 1, 1));
  y -= 40;

  // Fine print.
  ensure(70);
  page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 0.5, color: LIGHT });
  y -= 14;
  for (const l of wrap(INVOICE_FINE_PRINT, font, 7.5, right - M)) {
    ensure(10);
    text(l, M, 7.5, font, GRAY);
    y -= 10;
  }
  y -= 6;
  ensure(14);
  text("Thank you for your business!", M, 10, bold, NAVY);

  return pdf.save();
}
