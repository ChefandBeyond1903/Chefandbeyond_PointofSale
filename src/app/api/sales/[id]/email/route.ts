import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";
import { sendBrevoEmail, brevoConfigured } from "@/lib/brevo";
import { buildInvoiceEmailHtml, invoiceLabel } from "@/lib/invoiceEmail";
import { buildInvoicePdf } from "@/lib/invoicePdf";
import { payLinkFor } from "@/lib/payLink";
import { stripeConfigured } from "@/lib/stripe";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  to: z.string().trim().email("Enter a valid email address"),
  message: z.string().trim().max(2000).optional(),
});

// Whether outgoing email is set up — lets the UI say so before anyone tries.
export async function GET() {
  try {
    await requireScopedUser();
    return ok({ configured: brevoConfigured() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Emails this invoice to the given address through Brevo.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const { to, message } = bodySchema.parse(await req.json());

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { items: true, salesperson: { select: { name: true } } },
    });
    const scoped = scopeStoreId(actor);
    if (!sale || (scoped && sale.storeId !== scoped)) throw new HttpError(404, "Invoice not found");

    const company = await prisma.company.findUnique({ where: { id: "company" } });
    const storeName = sale.storeNameSnapshot || company?.name || "Chef and Beyond";
    const replyTo = sale.storeEmailSnapshot || company?.email || undefined;

    // "Pay now" button — only when Stripe and its webhook are both set up, so a
    // payment made through it is always recorded back on the invoice.
    const payUrl =
      sale.status === "INVOICED" &&
      sale.totalCents - sale.amountPaidCents > 0 &&
      stripeConfigured() &&
      process.env.STRIPE_WEBHOOK_SECRET
        ? payLinkFor(req.nextUrl.origin, sale.id)
        : undefined;

    const subject =`Invoice ${invoiceLabel(sale)} from ${storeName}`;
    // Log every attempt (sent or failed) — a logging hiccup never blocks or
    // hides the email itself.
    const log = (status: "SENT" | "FAILED", error = "") =>
      prisma.saleEmailLog
        .create({ data: { saleId: id, toEmail: to, subject, status, error, sentById: actor.id } })
        .catch(() => {});

    try {
      await sendBrevoEmail({
        to: [to],
        subject,
        html: buildInvoiceEmailHtml({
          sale,
          company,
          message,
          logoUrl: `${req.nextUrl.origin}/logo-email.png`,
          payUrl,
        }),
        attachments: [
          {
            name: `Invoice-${invoiceLabel(sale).replace(/[^A-Za-z0-9-]/g, "")}.pdf`,
            contentBase64: Buffer.from(await buildInvoicePdf(sale, company)).toString("base64"),
          },
        ],
        replyTo,
      });
    } catch (err) {
      await log("FAILED", err instanceof Error ? err.message : "Unknown error");
      throw err;
    }
    await log("SENT");
    return ok({ sent: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
