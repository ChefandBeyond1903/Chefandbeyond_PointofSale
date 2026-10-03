import { NextRequest } from "next/server";
import { z } from "zod";
import { requireScopedUser } from "@/lib/scope";
import { HttpError } from "@/lib/auth";
import { ok, toErrorResponse } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";
import { emailConfigured, invoiceEmailBody, sendEmail } from "@/lib/email";
import { balanceDueCents, invoiceLabel } from "@/lib/invoicePdf";
import { loadSaleForPdf, renderSalePdf, pdfFilename } from "@/lib/invoiceEmail";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  // Recipient. Omitted/blank = the customer's email on the invoice.
  to: z.string().trim().max(254).optional().default(""),
});

/** Is email set up on this deployment? (The button hides its UI otherwise.) */
export async function GET() {
  try {
    await requireScopedUser();
    return ok({ configured: emailConfigured() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Email the invoice/receipt PDF to the customer (or another address). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const { sale, company } = await loadSaleForPdf(id, actor);

    const to = (body.to || sale.customerEmailSnapshot || sale.customer?.email || "").trim().toLowerCase();
    if (!to) throw new HttpError(400, "This invoice has no customer email — enter one to send to.");
    if (!z.email().safeParse(to).success) throw new HttpError(400, "Enter a valid email address.");
    if (!sale.items.length) throw new HttpError(400, "This invoice has no items.");

    const pdf = await renderSalePdf(sale, company);
    const label = invoiceLabel(sale);
    const owing = balanceDueCents(sale);
    const storeName = sale.storeNameSnapshot || company?.name || "Chef and Beyond";
    const { subject, html } = invoiceEmailBody({
      label,
      firstName: (sale.customerNameSnapshot || sale.customer?.name || "").split(" ")[0],
      total: formatMoney(sale.totalCents),
      balanceDue: owing > 0 ? formatMoney(owing) : null,
      dueDate: sale.dueDate ? formatDateOnly(sale.dueDate.toISOString()) : null,
      storeName,
      phone: sale.storePhoneSnapshot || company?.phone || "",
    });
    const sent = await sendEmail({
      to,
      subject,
      html,
      replyTo: sale.storeEmailSnapshot || company?.email || undefined,
      attachments: [{ filename: pdfFilename(sale), content: Buffer.from(pdf).toString("base64") }],
    });
    if (!sent.ok) throw new HttpError(502, sent.error ?? "Email failed to send.");
    return ok({ ok: true, to, id: sent.id ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
