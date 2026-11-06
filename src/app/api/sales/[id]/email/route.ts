import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";
import { sendBrevoEmail, brevoConfigured } from "@/lib/brevo";
import { buildInvoiceEmailHtml, invoiceLabel } from "@/lib/invoiceEmail";

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

    await sendBrevoEmail({
      to: [to],
      subject: `Invoice ${invoiceLabel(sale)} from ${storeName}`,
      html: buildInvoiceEmailHtml({ sale, company, message }),
      replyTo,
    });
    return ok({ sent: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
