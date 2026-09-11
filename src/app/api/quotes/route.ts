import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, scopeStoreId } from "@/lib/scope";
import { quoteCreateSchema } from "@/lib/validation";
import { computeSale, type PricedInput } from "@/lib/sale";
import { formatMoney } from "@/lib/money";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const { searchParams } = new URL(req.url);
    const take = Math.min(Number(searchParams.get("take") ?? 50), 500);
    const q = searchParams.get("q")?.trim();
    const status = searchParams.get("status")?.trim().toUpperCase();

    const where: Prisma.QuoteWhereInput = {};
    // Non-admins only ever see their own store's quotes; an admin may narrow
    // to one store with ?storeId=.
    const scopedStore = scopeStoreId(actor);
    const storeParam = searchParams.get("storeId")?.trim();
    if (scopedStore) where.storeId = scopedStore;
    else if (storeParam) where.storeId = storeParam;
    if (status && ["OPEN", "APPROVED", "REJECTED", "CONVERTED"].includes(status)) {
      where.status = status;
    }
    if (q) {
      // Free-text search: match a number, or any customer snapshot.
      const asNumber = Number(q.replace(/[^0-9]/g, ""));
      const or: Prisma.QuoteWhereInput[] = [
        { customerNameSnapshot: { contains: q, mode: "insensitive" } },
        { customerCompanySnapshot: { contains: q, mode: "insensitive" } },
        { customerEmailSnapshot: { contains: q, mode: "insensitive" } },
        { customerPhoneSnapshot: { contains: q, mode: "insensitive" } },
      ];
      if (Number.isInteger(asNumber) && asNumber > 0) or.push({ number: asNumber });
      where.OR = or;
    }

    const quotes = await prisma.quote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      include: {
        createdBy: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
      },
    });
    return ok({ quotes });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const body = quoteCreateSchema.parse(await req.json());

    // The quoting store: the staff's own store, or — for an ADMIN, who has
    // none — one they choose. Its rate is only an estimate here; the real
    // invoice recomputes tax for real at conversion time.
    let store = actor.storeId ? await prisma.store.findUnique({ where: { id: actor.storeId } }) : null;
    if (actor.role === "ADMIN" && body.storeId) {
      const picked = await prisma.store.findUnique({ where: { id: body.storeId } });
      if (!picked) throw new HttpError(400, "That store doesn't exist.");
      store = picked;
    }
    const storeId = store?.id ?? null;
    let taxRateBps = store?.taxRateBps ?? 0;

    // Customer: an existing record (snapshotted), or a typed-but-unmatched
    // name/contact kept only as text on the quote (no Customer row created
    // for what might still be rejected).
    let cust = { id: null as string | null, name: "", email: "", phone: "", address: "", company: "" };
    let locationLabel = "";
    if (body.customerId) {
      const c = await prisma.customer.findUnique({ where: { id: body.customerId } });
      if (!c) throw new HttpError(400, "Customer not found");
      if (actor.role !== "ADMIN" && storeId && c.storeId && c.storeId !== storeId) {
        throw new HttpError(400, "That customer belongs to another store.");
      }
      cust = { id: c.id, name: c.name, email: c.email, phone: c.phone, address: c.address, company: c.company };
      const notExpired = !c.taxExemptExpiresAt || c.taxExemptExpiresAt >= new Date();
      if (c.taxExempt && notExpired) taxRateBps = 0;
      if (body.customerLocationId) {
        const loc = await prisma.customerLocation.findUnique({
          where: { id: body.customerLocationId },
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
    } else if (body.customer) {
      cust = {
        id: null,
        name: body.customer.name ?? "",
        email: body.customer.email ?? "",
        phone: body.customer.phone ?? "",
        address: body.customer.address ?? "",
        company: body.customer.company ?? "",
      };
    }

    // Merge duplicate product lines defensively.
    const merged = new Map<string, { quantity: number; discountCents: number; unitPriceCents?: number }>();
    for (const item of body.items) {
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

    // Unlike a sale, a quote MAY include a product with no cost yet — it's
    // just a proposal. The no-cost rule is enforced when the quote is
    // converted (it goes through the register / POST /api/sales, which
    // blocks it until every product has a cost).

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

    const computed = computeSale(priced, body.orderDiscountCents, taxRateBps, body.shippingCents);

    // UMRP floor — same hard stop as a sale, never bypassable.
    const umrpById = new Map(products.map((p) => [p.id, p.umrpCents]));
    for (const l of computed.lines) {
      const umrp = umrpById.get(l.productId) ?? 0;
      if (umrp <= 0) continue;
      const netCents = l.unitPriceCents * l.quantity - l.discountCents;
      if (netCents < umrp * l.quantity) {
        const eachCents = Math.floor(netCents / l.quantity);
        throw new HttpError(
          400,
          `"${l.nameSnapshot}" can't be quoted below its minimum price of ${formatMoney(umrp)} each ` +
            `(this quote works out to ${formatMoney(eachCents)}). Reduce the discount.`,
        );
      }
    }

    const skuById = new Map(products.map((p) => [p.id, p.sku]));

    const quote = await prisma.$transaction(async (tx) => {
      const last = await tx.quote.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
      const number = (last?.number ?? 0) + 1;
      return tx.quote.create({
        data: {
          number,
          status: "OPEN",
          subtotalCents: computed.subtotalCents,
          listSubtotalCents,
          discountCents: computed.discountCents,
          taxCents: computed.taxCents,
          taxRateBps: computed.taxRateBps,
          shippingCents: computed.shippingCents,
          totalCents: computed.totalCents,
          note: body.note,
          storeId,
          storeNameSnapshot: store?.name ?? "",
          customerId: cust.id,
          customerNameSnapshot: cust.name,
          customerCompanySnapshot: cust.company,
          customerEmailSnapshot: cust.email,
          customerPhoneSnapshot: cust.phone,
          customerAddressSnapshot: cust.address,
          customerLocationSnapshot: locationLabel,
          createdById: actor.id,
          items: {
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
          },
        },
        include: {
          items: true,
          customer: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });
    });

    return ok({ quote }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
