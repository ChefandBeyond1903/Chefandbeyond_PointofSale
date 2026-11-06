import { formatBps, formatMoney } from "@/lib/money";
import { INVOICE_FINE_PRINT } from "@/lib/invoiceFinePrint";

type EmailSale = {
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

type EmailCompany = { name: string; address: string; phone: string; email: string; website: string } | null;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const dateOnly = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "UTC" });

export function invoiceLabel(sale: Pick<EmailSale, "number" | "websiteOrderNumber">): string {
  return sale.websiteOrderNumber || `#${sale.number}`;
}

/** A self-contained, inline-styled HTML email for one invoice. */
export function buildInvoiceEmailHtml(opts: {
  sale: EmailSale;
  company: EmailCompany;
  message?: string;
}): string {
  const { sale, company, message } = opts;
  const storeName = sale.storeNameSnapshot || company?.name || "Chef and Beyond";
  const address = sale.storeAddressSnapshot || company?.address || "";
  const phone = sale.storePhoneSnapshot || company?.phone || "";
  const paid = sale.amountPaidCents ?? 0;
  const owing = sale.status === "INVOICED" && paid < sale.totalCents;

  const row = (label: string, value: string, bold = false, color = "#3f3f46") =>
    `<tr><td style="padding:3px 0;color:${color};${bold ? "font-weight:700;" : ""}">${label}</td>` +
    `<td style="padding:3px 0;text-align:right;color:${color};${bold ? "font-weight:700;" : ""}">${value}</td></tr>`;

  const itemRows = sale.items
    .map((it) => {
      const net = it.unitPriceCents * it.quantity - it.discountCents;
      const sub: string[] = [];
      if (it.discountCents > 0) {
        sub.push(`${formatMoney(it.unitPriceCents)} each — discounted − ${formatMoney(it.discountCents)}`);
      }
      if (it.serialNumber) sub.push(`S/N: ${esc(it.serialNumber)}`);
      return (
        `<tr><td style="padding:6px 0;border-bottom:1px solid #e4e4e7;">${it.quantity}× ${esc(it.nameSnapshot)}` +
        (sub.length ? `<div style="font-size:12px;color:#71717a;">${sub.join("<br>")}</div>` : "") +
        `</td><td style="padding:6px 0;border-bottom:1px solid #e4e4e7;text-align:right;vertical-align:top;white-space:nowrap;">${formatMoney(net)}</td></tr>`
      );
    })
    .join("");

  const billTo = [
    sale.customerCompanySnapshot || sale.customerNameSnapshot,
    sale.customerCompanySnapshot && sale.customerNameSnapshot !== sale.customerCompanySnapshot
      ? sale.customerNameSnapshot
      : "",
    sale.customerLocationSnapshot,
    sale.customerLocationSnapshot ? sale.customerAddressSnapshot : "",
  ].filter(Boolean);

  const payLabel = sale.paymentMethod === "CHECK" && sale.checkNumber ? `Check #${esc(sale.checkNumber)}` : esc(sale.paymentMethod);

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#18181b;">
<div style="max-width:620px;margin:0 auto;padding:16px;">
<div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;padding:24px;">
${message ? `<p style="margin:0 0 16px;white-space:pre-line;">${esc(message)}</p>` : ""}
<h1 style="margin:0;font-size:20px;">${esc(storeName)}</h1>
${address ? `<div style="color:#71717a;">${esc(address)}</div>` : ""}
${phone ? `<div style="color:#71717a;">${esc(phone)}</div>` : ""}
<h2 style="margin:20px 0 4px;font-size:16px;">Invoice ${esc(invoiceLabel(sale))}</h2>
<div style="color:#71717a;">${sale.createdAt.toLocaleDateString("en-US", { timeZone: "America/Chicago" })}${sale.salesperson?.name ? ` · Served by ${esc(sale.salesperson.name)}` : ""}</div>
${billTo.length ? `<div style="margin-top:10px;"><strong>Bill to:</strong><br>${billTo.map(esc).join("<br>")}</div>` : ""}
${sale.dueDate ? `<div style="margin-top:6px;color:#71717a;">${sale.termsSnapshot ? `${esc(sale.termsSnapshot)} — ` : ""}Due ${dateOnly(sale.dueDate)}</div>` : ""}
${sale.customerTaxExemptSnapshot ? `<div style="color:#71717a;">Tax-exempt sale</div>` : ""}
${sale.note ? `<p style="white-space:pre-line;color:#52525b;">${esc(sale.note)}</p>` : ""}
<table style="width:100%;border-collapse:collapse;margin-top:16px;">${itemRows}</table>
<table style="width:100%;border-collapse:collapse;margin-top:12px;">
${row("Subtotal", formatMoney(sale.subtotalCents))}
${sale.discountCents !== 0 ? row("Discount", `− ${formatMoney(sale.discountCents)}`) : ""}
${row(`Tax${sale.taxRateBps ? ` (${formatBps(sale.taxRateBps)})` : ""}`, formatMoney(sale.taxCents))}
${sale.shippingCents > 0 ? row("Shipping", formatMoney(sale.shippingCents)) : ""}
${row("Total", formatMoney(sale.totalCents), true, "#18181b")}
${
  owing
    ? row(paid > 0 ? "Deposit paid" : "Paid", formatMoney(paid)) +
      row("Balance due", formatMoney(sale.totalCents - paid), true, "#b91c1c")
    : row(payLabel, formatMoney(sale.totalCents))
}
</table>
<p style="margin:20px 0 0;text-align:center;color:#71717a;">Thank you!</p>
<p style="margin:16px 0 0;font-size:11px;line-height:1.4;color:#71717a;">${esc(INVOICE_FINE_PRINT)}</p>
${company?.email || company?.website ? `<p style="margin:12px 0 0;font-size:12px;color:#71717a;text-align:center;">${[company.email, company.website].filter(Boolean).map(esc).join(" · ")}</p>` : ""}
</div></div></body></html>`;
}
