import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { saleCreateSchema } from "@/lib/validation";
import { computeSale, type PricedInput } from "@/lib/sale";
import { formatMoney } from "@/lib/money";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const { searchParams } = new URL(req.url);
    const take = Math.min(Number(searchParams.get("take") ?? 50), 200);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const cashierId = searchParams.get("cashierId")?.trim();
    const number = Number(searchParams.get("number"));

    const where: Prisma.SaleWhereInput = {};
    if (cashierId) where.cashierId = cashierId;
    if (Number.isInteger(number) && number > 0) where.number = number;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const sales = await prisma.sale.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      include: {
        cashier: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        items: true,
      },
    });
    return ok({ sales });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = saleCreateSchema.parse(await req.json());

    // Sales tax is the cashier's assigned-store rate, applied to every line.
    const actor = await prisma.user.findUnique({
      where: { id: user.id },
      include: { store: true },
    });
    const taxRateBps = actor?.store?.taxRateBps ?? 0;
    const storeId = actor?.storeId ?? null;
    const storeNameSnapshot = actor?.store?.name ?? "";

    // Merge duplicate product lines defensively.
    const merged = new Map<string, { quantity: number; discountCents: number }>();
    for (const item of body.items) {
      const prev = merged.get(item.productId);
      if (prev) {
        prev.quantity += item.quantity;
        prev.discountCents += item.discountCents;
      } else {
        merged.set(item.productId, { quantity: item.quantity, discountCents: item.discountCents });
      }
    }

    const productIds = [...merged.keys()];
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    if (products.length !== productIds.length) {
      throw new HttpError(400, "One or more products no longer exist");
    }

    const priced: PricedInput[] = [];
    for (const p of products) {
      const line = merged.get(p.id)!;
      if (!p.active) throw new HttpError(400, `"${p.name}" is not available for sale`);
      // Overselling is allowed — stock is still tracked and may go negative.
      priced.push({
        productId: p.id,
        name: p.name,
        unitPriceCents: p.priceCents,
        quantity: line.quantity,
        lineDiscountCents: line.discountCents,
      });
    }

    const computed = computeSale(priced, body.orderDiscountCents, taxRateBps);

    // UMRP floor: after every discount, no line may fall below the product's
    // minimum resale price. Hard stop — this is never bypassable.
    const umrpById = new Map(products.map((p) => [p.id, p.umrpCents]));
    for (const l of computed.lines) {
      const umrp = umrpById.get(l.productId) ?? 0;
      if (umrp <= 0) continue;
      const netCents = l.unitPriceCents * l.quantity - l.discountCents;
      if (netCents < umrp * l.quantity) {
        const eachCents = Math.floor(netCents / l.quantity);
        throw new HttpError(
          400,
          `"${l.nameSnapshot}" can't be sold below its minimum price of ${formatMoney(umrp)} each ` +
            `(this sale works out to ${formatMoney(eachCents)}). Reduce the discount.`,
        );
      }
    }

    const meta = new Map(
      products.map((p) => [p.id, { sku: p.sku, vendor: p.vendor, costCents: p.costCents }]),
    );

    let tenderedCents = computed.totalCents;
    let changeCents = 0;
    if (body.paymentMethod === "CASH") {
      tenderedCents = body.tenderedCents;
      if (tenderedCents < computed.totalCents) {
        throw new HttpError(400, "Amount tendered is less than the total due");
      }
      changeCents = tenderedCents - computed.totalCents;
    }

    const openShift = await prisma.shift.findFirst({
      where: { userId: user.id, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });

    const sale = await prisma.$transaction(async (tx) => {
      const last = await tx.sale.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
      const number = (last?.number ?? 0) + 1;

      // Resolve the customer: use the given id, else match by name/email, else
      // auto-create. Blank fields on an existing record get filled in.
      let customerId: string | null = null;
      let cSnap = { name: "", email: "", phone: "", address: "" };
      if (body.customerId) {
        const c = await tx.customer.findUnique({ where: { id: body.customerId } });
        if (!c) throw new HttpError(400, "Customer not found");
        customerId = c.id;
        cSnap = { name: c.name, email: c.email, phone: c.phone, address: c.address };
      } else if (body.customer) {
        const inp = body.customer;
        const existing = await tx.customer.findFirst({
          where: {
            OR: [{ name: inp.name }, ...(inp.email ? [{ email: inp.email }] : [])],
          },
        });
        if (existing) {
          const patch: Record<string, string> = {};
          if (!existing.email && inp.email) patch.email = inp.email;
          if (!existing.phone && inp.phone) patch.phone = inp.phone;
          if (!existing.address && inp.address) patch.address = inp.address;
          if (!existing.company && inp.company) patch.company = inp.company;
          const c = Object.keys(patch).length
            ? await tx.customer.update({ where: { id: existing.id }, data: patch })
            : existing;
          customerId = c.id;
          cSnap = { name: c.name, email: c.email, phone: c.phone, address: c.address };
        } else {
          const c = await tx.customer.create({
            data: {
              name: inp.name,
              email: inp.email,
              phone: inp.phone,
              address: inp.address,
              company: inp.company,
            },
          });
          customerId = c.id;
          cSnap = { name: c.name, email: c.email, phone: c.phone, address: c.address };
        }
      }

      const created = await tx.sale.create({
        data: {
          number,
          status: "COMPLETED",
          subtotalCents: computed.subtotalCents,
          discountCents: computed.discountCents,
          taxCents: computed.taxCents,
          taxRateBps: computed.taxRateBps,
          totalCents: computed.totalCents,
          paymentMethod: body.paymentMethod,
          tenderedCents,
          changeCents,
          note: body.note,
          cashierId: user.id,
          storeId,
          storeNameSnapshot,
          shiftId: openShift?.id ?? null,
          customerId,
          customerNameSnapshot: cSnap.name,
          customerEmailSnapshot: cSnap.email,
          customerPhoneSnapshot: cSnap.phone,
          customerAddressSnapshot: cSnap.address,
          items: {
            create: computed.lines.map((l) => ({
              productId: l.productId,
              nameSnapshot: l.nameSnapshot,
              skuSnapshot: meta.get(l.productId)?.sku ?? "",
              vendorSnapshot: meta.get(l.productId)?.vendor ?? "",
              unitPriceCents: l.unitPriceCents,
              unitCostCents: meta.get(l.productId)?.costCents ?? 0,
              quantity: l.quantity,
              discountCents: l.discountCents,
              taxRateBps: l.taxRateBps,
              lineTotalCents: l.lineTotalCents,
            })),
          },
        },
        include: {
          items: true,
          cashier: { select: { id: true, name: true } },
          customer: true,
        },
      });

      for (const p of products) {
        if (!p.trackStock) continue;
        const line = merged.get(p.id)!;
        await tx.product.update({
          where: { id: p.id },
          data: { stock: { decrement: line.quantity } },
        });
      }

      return created;
    });

    return ok({ sale }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
