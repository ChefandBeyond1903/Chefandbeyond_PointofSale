import "server-only";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { scopeStoreId, type ScopedUser } from "@/lib/scope";
import { buildInvoicePdf, type InvoicePdfSale } from "@/lib/invoicePdf";

/**
 * Load one sale (scoped to the caller's store) with everything the invoice
 * PDF needs, plus the company card for the header fallbacks.
 */
export async function loadSaleForPdf(id: string, actor: ScopedUser) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      items: { orderBy: { id: "asc" } },
      payments: { orderBy: { paidAt: "asc" } },
      salesperson: { select: { name: true } },
      cashier: { select: { name: true } },
      customer: { select: { email: true, name: true } },
    },
  });
  if (!sale) throw new HttpError(404, "Sale not found");
  const scoped = scopeStoreId(actor);
  if (scoped && sale.storeId !== scoped) throw new HttpError(404, "Sale not found");
  const company = await prisma.company.findUnique({ where: { id: "company" } });
  return { sale, company };
}

export async function renderSalePdf(sale: Awaited<ReturnType<typeof loadSaleForPdf>>["sale"], company: Awaited<ReturnType<typeof loadSaleForPdf>>["company"]) {
  const pdfSale: InvoicePdfSale = {
    ...sale,
    salesperson: sale.salesperson ?? sale.cashier ?? null,
  };
  return buildInvoicePdf(pdfSale, company);
}

export function pdfFilename(sale: { number: number; websiteOrderNumber?: string | null }): string {
  const ref = (sale.websiteOrderNumber || String(sale.number)).replace(/[^A-Za-z0-9_-]+/g, "-");
  return `chef-and-beyond-invoice-${ref}.pdf`;
}
