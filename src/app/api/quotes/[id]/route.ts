import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, requireScopedRole, scopeStoreId } from "@/lib/scope";
import { quoteStatusSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

async function loadScoped(id: string, actor: Awaited<ReturnType<typeof requireScopedUser>>) {
  const quote = await prisma.quote.findUnique({ where: { id }, select: { storeId: true } });
  const scoped = scopeStoreId(actor);
  if (!quote || (scoped && quote.storeId !== scoped)) {
    throw new HttpError(404, "Quote not found");
  }
}

// Returns the quote (with items) plus the live Product rows for each item, so
// the register can rehydrate a cart from it when converting to an invoice.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    await loadScoped(id, actor);

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        items: true,
        customer: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        convertedSale: { select: { id: true, number: true, status: true } },
      },
    });
    if (!quote) throw new HttpError(404, "Quote not found");

    const products = await prisma.product.findMany({
      where: { id: { in: quote.items.map((l) => l.productId) } },
      include: { category: { select: { id: true, name: true } } },
    });

    return ok({ quote, products: products.map((p) => ({ ...p, stock: 0 })) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Approve / reject / reopen a quote, or — set internally by the register once
// the resulting sale is created — mark it converted.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const quote = await prisma.quote.findUnique({ where: { id } });
    if (!quote) throw new HttpError(404, "Quote not found");
    const scoped = scopeStoreId(actor);
    if (scoped && quote.storeId !== scoped) throw new HttpError(404, "Quote not found");

    const body = quoteStatusSchema.parse(await req.json());

    if (quote.status === "CONVERTED") {
      throw new HttpError(400, "This quote has already been converted to an invoice.");
    }
    if (body.status === "CONVERTED") {
      if (quote.status !== "APPROVED") {
        throw new HttpError(400, "Approve the quote before converting it to an invoice.");
      }
      if (!body.convertedSaleId) throw new HttpError(400, "Missing the resulting sale.");
      const sale = await prisma.sale.findUnique({
        where: { id: body.convertedSaleId },
        select: { id: true },
      });
      if (!sale) throw new HttpError(400, "That sale doesn't exist.");
    }

    const updated = await prisma.quote.update({
      where: { id },
      data: {
        status: body.status,
        ...(body.status === "CONVERTED"
          ? { convertedSaleId: body.convertedSaleId, convertedAt: new Date() }
          : {}),
      },
      include: {
        items: true,
        customer: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        convertedSale: { select: { id: true, number: true, status: true } },
      },
    });
    return ok({ quote: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    const quote = await prisma.quote.findUnique({ where: { id } });
    if (!quote) throw new HttpError(404, "Quote not found");
    const scoped = scopeStoreId(actor);
    if (scoped && quote.storeId !== scoped) throw new HttpError(404, "Quote not found");
    if (quote.status === "CONVERTED") {
      throw new HttpError(400, "Can't delete a quote that's already been converted to an invoice.");
    }
    await prisma.quote.delete({ where: { id } });
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
