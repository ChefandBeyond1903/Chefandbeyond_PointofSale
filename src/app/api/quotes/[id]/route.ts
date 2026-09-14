import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, requireScopedRole, scopeStoreId } from "@/lib/scope";
import { quoteStatusSchema, quoteEditSchema } from "@/lib/validation";
import { computeSale, type PricedInput } from "@/lib/sale";
import { formatMoney } from "@/lib/money";
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

// Two things happen through this PATCH:
//  - a body with `status` approves/rejects/reopens the quote, or — set
//    internally by the register once the resulting sale is created — marks
//    it converted;
//  - anything else edits the quote's note and/or line items.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const quote = await prisma.quote.findUnique({ where: { id } });
    if (!quote) throw new HttpError(404, "Quote not found");
    const scoped = scopeStoreId(actor);
    if (scoped && quote.storeId !== scoped) throw new HttpError(404, "Quote not found");

    const raw = await req.json();
    if (!raw || typeof raw !== "object" || !("status" in raw)) {
      // --- edit: note and/or line items ---
      if (quote.status === "CONVERTED") {
        throw new HttpError(400, "This quote has already been converted to an invoice.");
      }
      const fields = quoteEditSchema.parse(raw);
      const data: Record<string, unknown> = {};
      if (fields.note !== undefined) data.note = fields.note;

      // Bill-to: link an existing customer (+ optional location), detach one
      // (customerId: null), or set a free-text one not in the directory.
      // `resolvedCustomerId` stays undefined when the bill-to wasn't touched,
      // so the tax-exempt lookup below falls back to the quote's current one.
      let resolvedCustomerId: string | null | undefined;
      if (fields.customerId !== undefined || fields.customer !== undefined) {
        if (fields.customerId) {
          const c = await prisma.customer.findUnique({ where: { id: fields.customerId } });
          if (!c) throw new HttpError(400, "Customer not found");
          if (scoped && c.storeId && c.storeId !== scoped) {
            throw new HttpError(400, "That customer belongs to another store.");
          }
          const cust = { name: c.name, email: c.email, phone: c.phone, address: c.address };
          let locationLabel = "";
          if (fields.customerLocationId) {
            const loc = await prisma.customerLocation.findUnique({
              where: { id: fields.customerLocationId },
            });
            if (!loc || loc.customerId !== c.id) {
              throw new HttpError(400, "That location isn't on this customer.");
            }
            locationLabel = loc.label;
            if (loc.address) cust.address = loc.address;
            if (loc.contact) cust.name = loc.contact;
            if (loc.phone) cust.phone = loc.phone;
            if (loc.email) cust.email = loc.email;
          }
          resolvedCustomerId = c.id;
          data.customerId = c.id;
          data.customerNameSnapshot = cust.name;
          data.customerCompanySnapshot = c.company;
          data.customerEmailSnapshot = cust.email;
          data.customerPhoneSnapshot = cust.phone;
          data.customerAddressSnapshot = cust.address;
          data.customerLocationSnapshot = locationLabel;
        } else if (fields.customer) {
          resolvedCustomerId = null;
          data.customerId = null;
          data.customerNameSnapshot = fields.customer.name ?? "";
          data.customerCompanySnapshot = fields.customer.company ?? "";
          data.customerEmailSnapshot = fields.customer.email ?? "";
          data.customerPhoneSnapshot = fields.customer.phone ?? "";
          data.customerAddressSnapshot = fields.customer.address ?? "";
          data.customerLocationSnapshot = "";
        } else {
          // customerId sent as null (or "") — detach.
          resolvedCustomerId = null;
          data.customerId = null;
          data.customerNameSnapshot = "";
          data.customerCompanySnapshot = "";
          data.customerEmailSnapshot = "";
          data.customerPhoneSnapshot = "";
          data.customerAddressSnapshot = "";
          data.customerLocationSnapshot = "";
        }
      }

      // Reprice whenever the items changed, or the bill-to did (a different
      // customer can change tax-exempt status even with the same items).
      if (fields.items || resolvedCustomerId !== undefined) {
        // Source lines: what was sent, or — for a bill-to-only edit — the
        // quote's current items, unchanged.
        const sourceItems =
          fields.items ??
          (await prisma.quoteItem.findMany({ where: { quoteId: id } })).map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            discountCents: it.discountCents,
            unitPriceCents: it.unitPriceCents,
          }));

        // Merge duplicate product lines defensively, same as creating a quote.
        const merged = new Map<
          string,
          { quantity: number; discountCents: number; unitPriceCents?: number }
        >();
        for (const item of sourceItems) {
          const prev = merged.get(item.productId);
          if (prev) {
            prev.quantity += item.quantity;
            prev.discountCents += item.discountCents;
            if (item.unitPriceCents !== undefined) prev.unitPriceCents = item.unitPriceCents;
          } else {
            merged.set(item.productId, {
              quantity: item.quantity,
              discountCents: item.discountCents,
              unitPriceCents: item.unitPriceCents,
            });
          }
        }

        const productIds = [...merged.keys()];
        const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
        if (products.length !== productIds.length) {
          throw new HttpError(400, "One or more products no longer exist");
        }

        const priced: PricedInput[] = [];
        let listSubtotalCents = 0;
        for (const p of products) {
          const line = merged.get(p.id)!;
          if (!p.active) throw new HttpError(400, `"${p.name}" is not available for sale`);
          listSubtotalCents += p.priceCents * line.quantity;
          priced.push({
            productId: p.id,
            name: p.name,
            unitPriceCents: line.unitPriceCents ?? p.priceCents,
            quantity: line.quantity,
            lineDiscountCents: line.discountCents,
          });
        }

        // Tax rate: re-derive from the store (and any tax-exempt customer),
        // same estimate logic as creating the quote. No extra order discount
        // here — each line already carries whatever discount it had.
        const store = quote.storeId
          ? await prisma.store.findUnique({ where: { id: quote.storeId } })
          : null;
        let taxRateBps = store?.taxRateBps ?? 0;
        const taxCustomerId = resolvedCustomerId !== undefined ? resolvedCustomerId : quote.customerId;
        if (taxCustomerId) {
          const c = await prisma.customer.findUnique({
            where: { id: taxCustomerId },
            select: { taxExempt: true, taxExemptExpiresAt: true },
          });
          if (c) {
            const notExpired = !c.taxExemptExpiresAt || c.taxExemptExpiresAt >= new Date();
            if (c.taxExempt && notExpired) taxRateBps = 0;
          }
        }

        const computed = computeSale(priced, 0, taxRateBps, quote.shippingCents);

        // UMRP floor — same hard stop as creating a quote.
        const umrpById = new Map(products.map((p) => [p.id, p.umrpCents]));
        for (const l of computed.lines) {
          const umrp = umrpById.get(l.productId) ?? 0;
          if (umrp <= 0) continue;
          const netCents = l.unitPriceCents * l.quantity - l.discountCents;
          if (netCents < umrp * l.quantity) {
            const eachCents = Math.floor(netCents / l.quantity);
            throw new HttpError(
              400,
              `"${l.nameSnapshot}" can't be quoted below its minimum price of ${formatMoney(umrp)} ` +
                `each (this quote works out to ${formatMoney(eachCents)}). Reduce the discount.`,
            );
          }
        }

        const skuById = new Map(products.map((p) => [p.id, p.sku]));
        data.subtotalCents = computed.subtotalCents;
        data.listSubtotalCents = listSubtotalCents;
        data.discountCents = computed.discountCents;
        data.taxCents = computed.taxCents;
        data.taxRateBps = computed.taxRateBps;
        data.totalCents = computed.totalCents;
        data.items = {
          deleteMany: {},
          create: computed.lines.map((l) => ({
            productId: l.productId,
            nameSnapshot: l.nameSnapshot,
            skuSnapshot: skuById.get(l.productId) ?? "",
            unitPriceCents: l.unitPriceCents,
            quantity: l.quantity,
            discountCents: l.discountCents,
            taxRateBps: l.taxRateBps,
            lineTotalCents: l.lineTotalCents,
          })),
        };
        // A price/item change invalidates a prior approval.
        if (quote.status === "APPROVED") data.status = "OPEN";
      }

      const updated = await prisma.quote.update({
        where: { id },
        data,
        include: {
          items: true,
          customer: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          convertedSale: { select: { id: true, number: true, status: true } },
        },
      });
      return ok({ quote: updated });
    }

    // --- status change: approve / reject / reopen / convert ---
    const body = quoteStatusSchema.parse(raw);

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
