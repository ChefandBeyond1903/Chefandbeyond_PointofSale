import { formatBps, formatMoney } from "@/lib/money";
import { INVOICE_FINE_PRINT } from "@/lib/invoiceFinePrint";

export type EmailSale = {
  number: number;
  websiteOrderNumber: string | null;
  createdAt: Date;
  status: string;
  storeNameSnapshot: string;
  storeAddressSnapshot: string;
  storePhoneSnapshot: string;
  customerNameSnapshot: string;
  customerCompanySnapshot: string;
  customerLocationSnapshot: string;
  customerAddressSnapshot: string;
  customerTaxExemptSnapshot: boolean;
  termsSnapshot: string | null;
  dueDate: Date | null;
  note: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  taxRateBps: number;
  shippingCents: number;
  totalCents: number;
  amountPaidCents: number | null;
  paymentMethod: string;
  checkNumber: string | null;
  items: {
    quantity: number;
    nameSnapshot: string;
    unitPriceCents: number;
    discountCents: number;
    serialNumber: string | null;
  }[];
  salesperson: { name: string } | null;
};

export type EmailCompany = {
  name: string;
  legalName?: string;
  address: string;
  phone: string;
  email: string;
  website: string;
} | null;

// Brand colors, from the logo.
const NAVY = "#1f2a3c";
const GREEN = "#3d8b2f";

export const BUSINESS_HOURS = ["Monday - Friday: 9:00 am - 5:00 pm", "Saturday and Sunday by Appointment Only"];

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const dateOnly = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "UTC" });

export function invoiceLabel(sale: Pick<EmailSale, "number" | "websiteOrderNumber">): string {
  return sale.websiteOrderNumber || `#${sale.number}`;
}

/** What's still owed (0 for a paid invoice). */
export function balanceDueCents(sale: Pick<EmailSale, "status" | "totalCents" | "amountPaidCents">): number {
  if (sale.status !== "INVOICED") return 0;
  return Math.max(0, sale.totalCents - (sale.amountPaidCents ?? 0));
}

/** "Mesut Keklik" — who the email is addressed to. */
export function greetingName(sale: Pick<EmailSale, "customerNameSnapshot" | "customerCompanySnapshot">): string {
  return sale.customerNameSnapshot || sale.customerCompanySnapshot || "";
}

/** A modern, self-contained, inline-styled HTML email for one invoice. */
export function buildInvoiceEmailHtml(opts: {
  sale: EmailSale;
  company: EmailCompany;
  message?: string;
  logoUrl?: string;
  /** "Pay now" button target — only shown while a balance is owed. */
  payUrl?: string;
}): string {
  const { sale, company, message, logoUrl, payUrl } = opts;
  const storeName = sale.storeNameSnapshot || company?.name || "Chef and Beyond";
  const address = sale.storeAddressSnapshot || company?.address || "";
  const phone = sale.storePhoneSnapshot || company?.phone || "";
  const balance = balanceDueCents(sale);
  const owing = balance > 0;
  const name = greetingName(sale);

  const row = (label: string, value: string, bold = false, color = "#52525b") =>
    `<tr><td style="padding:4px 0;color:${color};${bold ? "font-weight:700;font-size:15px;" : ""}">${label}</td>` +
    `<td style="padding:4px 0;text-align:right;color:${color};${bold ? "font-weight:700;font-size:15px;" : ""}">${value}</td></tr>`;

  const itemRows = sale.items
    .map((it) => {
      const net = it.unitPriceCents * it.quantity - it.discountCents;
      const sub: string[] = [];
      if (it.discountCents > 0) {
        sub.push(`${formatMoney(it.unitPriceCents)} each — discounted − ${formatMoney(it.discountCents)}`);
      }
      if (it.serialNumber) sub.push(`S/N: ${esc(it.serialNumber)}`);
      return (
        `<tr><td style="padding:10px 0;border-bottom:1px solid #eef0f3;">${it.quantity} × ${esc(it.nameSnapshot)}` +
        (sub.length ? `<div style="font-size:12px;color:#8b93a1;margin-top:2px;">${sub.join("<br>")}</div>` : "") +
        `</td><td style="padding:10px 0;border-bottom:1px solid #eef0f3;text-align:right;vertical-align:top;white-space:nowrap;font-weight:600;">${formatMoney(net)}</td></tr>`
      );
    })
    .join("");

  const sigLines = [
    company?.name || storeName,
    address,
    ...BUSINESS_HOURS,
  ].filter(Boolean);
  const legalLines = [
    company?.legalName,
    address,
    company?.email,
    phone,
    company?.website,
  ].filter(Boolean) as string[];

  const intro = owing
    ? `Please find the detailed invoice attached to this email for your review. We kindly request your prompt attention to settle this invoice by the due date shown above.`
    : `Please find your invoice attached to this email for your records. Thank you for your payment!`;

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f5f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#27303f;">
<div style="max-width:640px;margin:0 auto;padding:24px 12px;">
<div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(31,42,60,0.08);">
<div style="height:6px;background:${GREEN};"></div>
<div style="padding:28px 32px 8px;text-align:center;">
${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(company?.name || "Chef and Beyond")}" width="220" style="display:block;margin:0 auto;max-width:220px;height:auto;border:0;">` : `<div style="font-size:22px;font-weight:700;color:${NAVY};">${esc(storeName)}</div>`}
</div>
<div style="padding:8px 32px 28px;text-align:center;">
<h1 style="margin:18px 0 18px;font-size:26px;line-height:1.2;color:${NAVY};">Your invoice is ready!</h1>
<div style="background:#f6f8fb;border-radius:12px;padding:20px 16px;">
<div style="font-size:11px;letter-spacing:1.5px;font-weight:700;color:#8b93a1;">${owing ? "BALANCE DUE" : "PAID IN FULL"}</div>
<div style="font-size:38px;line-height:1.15;font-weight:800;color:${owing ? NAVY : GREEN};margin-top:4px;">${formatMoney(balance)}</div>
<div style="margin-top:10px;color:#52525b;">Total <strong>${formatMoney(sale.totalCents)}</strong>${sale.dueDate ? ` &nbsp;·&nbsp; Due <strong>${dateOnly(sale.dueDate)}</strong>` : ""}</div>
<div style="margin-top:4px;color:#8b93a1;font-size:12px;">Invoice ${esc(invoiceLabel(sale))} · ${sale.createdAt.toLocaleDateString("en-US", { timeZone: "America/Chicago" })}${sale.termsSnapshot ? ` · ${esc(sale.termsSnapshot)}` : ""}</div>
${owing && payUrl ? `<div style="margin-top:20px;"><a href="${esc(payUrl)}" style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 40px;border-radius:999px;">Pay ${formatMoney(balance)} now</a><div style="margin-top:8px;font-size:11px;color:#8b93a1;">Secure card payment powered by Stripe</div></div>` : ""}
</div>
</div>

<div style="padding:0 32px 8px;">
${name ? `<p style="margin:0 0 12px;">Dear ${esc(name)},</p>` : ""}
${message ? `<p style="margin:0 0 12px;white-space:pre-line;">${esc(message)}</p>` : ""}
<p style="margin:0 0 12px;">${intro}</p>
<p style="margin:0 0 12px;">If you have any questions or concerns regarding the invoice or need further clarification regarding the charges, please do not hesitate to reach us.</p>
<p style="margin:0 0 12px;">We greatly appreciate your business and look forward to your continued partnership.</p>
</div>

<div style="padding:8px 32px 8px;">
<div style="font-size:11px;letter-spacing:1.5px;font-weight:700;color:#8b93a1;margin-bottom:4px;">SUMMARY</div>
<table style="width:100%;border-collapse:collapse;">${itemRows}</table>
<table style="width:100%;border-collapse:collapse;margin-top:10px;">
${row("Subtotal", formatMoney(sale.subtotalCents))}
${sale.discountCents !== 0 ? row("Discount", `− ${formatMoney(sale.discountCents)}`) : ""}
${row(`Tax${sale.taxRateBps ? ` (${formatBps(sale.taxRateBps)})` : ""}${sale.customerTaxExemptSnapshot ? " — exempt" : ""}`, formatMoney(sale.taxCents))}
${sale.shippingCents > 0 ? row("Shipping", formatMoney(sale.shippingCents)) : ""}
${row("Total", formatMoney(sale.totalCents), true, NAVY)}
${sale.status === "INVOICED" && (sale.amountPaidCents ?? 0) > 0 ? row("Paid", `− ${formatMoney(sale.amountPaidCents ?? 0)}`) : ""}
${owing ? row("Balance due", formatMoney(balance), true, "#b91c1c") : ""}
</table>
</div>

<div style="padding:20px 32px 8px;">
<p style="margin:0 0 4px;">Have a great day,</p>
<p style="margin:0;font-weight:700;color:${NAVY};">${sigLines.map(esc).join("<br>")}</p>
</div>

<div style="margin:20px 32px 0;padding:16px 0 0;border-top:1px solid #eef0f3;font-size:12px;color:#6b7280;">
${legalLines.map(esc).join("<br>")}
</div>
<div style="padding:14px 32px 28px;font-size:10.5px;line-height:1.45;color:#9aa1ad;">${esc(INVOICE_FINE_PRINT)}</div>
</div>
<p style="text-align:center;font-size:11px;color:#9aa1ad;margin:14px 0 0;">${esc(company?.name || storeName)}</p>
</div></body></html>`;
}
