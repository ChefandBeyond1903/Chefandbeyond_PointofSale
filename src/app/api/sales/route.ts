import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { requireScopedUser, scopeStoreId } from "@/lib/scope";
import { saleCreateSchema } from "@/lib/validation";
import { computeSale, type PricedInput } from "@/lib/sale";
import { dueDateFromTerms } from "@/lib/terms";
import { formatMoney } from "@/lib/money";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const { searchParams } = new URL(req.url);
    const take = Math.min(Number(searchParams.get("take") ?? 50), 200);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const cashierId = searchParams.get("cashierId")?.trim();
    const number = Number(searchParams.get("number"));

    const where: Prisma.SaleWhereInput = {};
    // Non-admins only ever see their own store's sales.
    const scopedStore = scopeStoreId(actor);
    if (scopedStore) where.storeId = scopedStore;
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
        salesperson: { select: { id: true, name: true } },
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

    const actor = await prisma.user.findUnique({
      where: { id: user.id },
      include: { store: true },
    });

    // The selling store: the operator's assigned store, or — for an ADMIN, who
    // has none — one they choose per sale. Its rate is the sales-tax rate and
    // its inventory is what the sale draws down.
    let sellStore = actor?.store ?? null;
    if (actor?.role === "ADMIN" && body.storeId) {
      const picked = await prisma.store.findUnique({ where: { id: body.storeId } });
      if (!picked) throw new HttpError(400, "That store doesn't exist.");
      sellStore = picked;
    }
    let taxRateBps = sellStore?.taxRateBps ?? 0;
    const storeId = sellStore?.id ?? null;

    // A tax-exempt customer (with an unexpired certificate) rings at 0% tax.
    // Their payment terms set the invoice due date.
    let customerTaxExempt = false;
    let customerTerms = "";
    let customerStoreCreditCents = 0;
    if (body.customerId) {
      const c = await prisma.customer.findUnique({
        where: { id: body.customerId },
        select: {
          taxExempt: true,
          taxExemptExpiresAt: true,
          paymentTerms: true,
          storeCreditCents: true,
        },
      });
      if (c) {
        customerTerms = c.paymentTerms ?? "";
        customerStoreCreditCents = c.storeCreditCents;
        const notExpired = !c.taxExemptExpiresAt || c.taxExemptExpiresAt >= new Date();
        if (c.taxExempt && notExpired) {
          customerTaxExempt = true;
          taxRateBps = 0;
        }
      }
    }
    const invoiceDueDate = customerTerms ? dueDateFromTerms(new Date(), customerTerms) : null;
    const storeNameSnapshot = sellStore?.name ?? "";
    const storeAddressSnapshot = sellStore?.address ?? "";
    const storePhoneSnapshot = sellStore?.phone ?? "";
    const storeEmailSnapshot = sellStore?.email ?? "";

    // Credit the sale to the chosen salesperson (defaults to the operator).
    // They must be an active user in the same store (any active user for admin).
    let salespersonId = user.id;
    if (body.salespersonId && body.salespersonId !== user.id) {
      const sp = await prisma.user.findFirst({
        where: {
          id: body.salespersonId,
          active: true,
          ...(actor?.role === "ADMIN" ? {} : { storeId: actor?.storeId ?? "__none__" }),
        },
        select: { id: true },
      });
      if (!sp) throw new HttpError(400, "That salesperson isn't available for this store");
      salespersonId = sp.id;
    }

    // Merge duplicate product lines defensively.
    const merged = new Map<
      string,
      { quantity: number; discountCents: number; unitPriceCents?: number }
    >();
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

    const priced: PricedInput[] = [];
    let listSubtotalCents = 0;
    for (const p of products) {
      const line = merged.get(p.id)!;
      if (!p.active) throw new HttpError(400, `"${p.name}" is not available for sale`);
      listSubtotalCents += p.priceCents * line.quantity;
      // Overselling is allowed — stock is still tracked and may go negative.
      priced.push({
        productId: p.id,
        name: p.name,
        // A manual price (up or down) overrides the catalog price for this sale.
        unitPriceCents: line.unitPriceCents ?? p.priceCents,
        quantity: line.quantity,
        lineDiscountCents: line.discountCents,
      });
    }

    const computed = computeSale(priced, body.orderDiscountCents, taxRateBps, body.shippingCents);

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

    const total = computed.totalCents;
    const isTermsInvoice = customerTerms !== "";
    const deposit = Math.max(0, body.depositCents);

    // What is collected at the register right now:
    //  - a deposit / part-payment  -> INVOICED with a balance still due
    //    (or COMPLETED if the deposit covers the whole total);
    //  - a terms customer, no deposit -> INVOICED, nothing collected;
    //  - otherwise the full total is charged now -> COMPLETED.
    let paidNowCents = 0;
    let payMethod: "CASH" | "CARD" | "CREDIT" | null = null;
    let tenderedCents = 0;
    let changeCents = 0;

    if (deposit > 0) {
      if (!body.depositMethod) throw new HttpError(400, "Choose how the deposit was paid.");
      if (deposit < total && !body.customerId && !body.customer) {
        throw new HttpError(400, "Add a customer before taking a deposit.");
      }
      payMethod = body.depositMethod;
      paidNowCents = Math.min(deposit, total);
      if (payMethod === "CASH") {
        tenderedCents = Math.max(body.tenderedCents, deposit);
        changeCents = Math.max(0, tenderedCents - deposit);
      } else {
        tenderedCents = deposit;
      }
    } else if (isTermsInvoice) {
      // nothing collected now
    } else {
      if (!body.paymentMethod) throw new HttpError(400, "Choose a payment method.");
      payMethod = body.paymentMethod;
      paidNowCents = total;
      if (payMethod === "CASH") {
        tenderedCents = body.tenderedCents;
        if (tenderedCents < total) {
          throw new HttpError(400, "Amount tendered is less than the total due");
        }
        changeCents = tenderedCents - total;
      } else {
        tenderedCents = total;
      }
    }

    if (payMethod === "CREDIT") {
      if (!body.customerId) {
        throw new HttpError(400, "Store credit needs an existing customer.");
      }
      if (paidNowCents > customerStoreCreditCents) {
        throw new HttpError(
          400,
          `Only ${(customerStoreCreditCents / 100).toFixed(2)} of store credit is available.`,
        );
      }
      tenderedCents = paidNowCents;
      changeCents = 0;
    }

    const settledNow = paidNowCents >= total;
    const openShift = payMethod
      ? await prisma.shift.findFirst({
          where: { userId: user.id, status: "OPEN" },
          orderBy: { openedAt: "desc" },
        })
      : null;

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
          status: settledNow ? "COMPLETED" : "INVOICED",
          paidAt: settledNow ? new Date() : null,
          subtotalCents: computed.subtotalCents,
          listSubtotalCents,
          discountCents: computed.discountCents,
          taxCents: computed.taxCents,
          taxRateBps: computed.taxRateBps,
          shippingCents: computed.shippingCents,
          totalCents: computed.totalCents,
          paymentMethod: payMethod ?? "",
          tenderedCents,
          changeCents,
          amountPaidCents: paidNowCents,
          note: body.note,
          termsSnapshot: customerTerms,
          dueDate: invoiceDueDate,
          customerTaxExemptSnapshot: customerTaxExempt,
          cashierId: user.id,
          salespersonId,
          storeId,
          storeNameSnapshot,
          storeAddressSnapshot,
          storePhoneSnapshot,
          storeEmailSnapshot,
          shiftId: settledNow ? (openShift?.id ?? null) : null,
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
          salesperson: { select: { id: true, name: true } },
          customer: true,
        },
      });

      // Record the money taken now (a deposit, or the full payment) as its own
      // row so the till and the customer-deposit liability reconcile.
      if (payMethod && paidNowCents > 0) {
        await tx.salePayment.create({
          data: {
            saleId: created.id,
            amountCents: paidNowCents,
            method: payMethod,
            paidAt: new Date(),
            isDeposit: !settledNow,
            createdById: user.id,
            shiftId: openShift?.id ?? null,
          },
        });
        // Paying with store credit draws the customer's balance down.
        if (payMethod === "CREDIT" && customerId) {
          await tx.customer.update({
            where: { id: customerId },
            data: { storeCreditCents: { decrement: paidNowCents } },
          });
          await tx.storeCreditEntry.create({
            data: {
              customerId,
              amountCents: -paidNowCents,
              kind: "SPEND",
              reason: `Sale #${number}`,
              saleId: created.id,
              createdById: user.id,
            },
          });
        }
      }

      // Draw stock down from the selling store's inventory (may go negative).
      if (storeId) {
        for (const p of products) {
          if (!p.trackStock) continue;
          const line = merged.get(p.id)!;
          await tx.storeInventory.upsert({
            where: { productId_storeId: { productId: p.id, storeId } },
            create: { productId: p.id, storeId, quantity: -line.quantity },
            update: { quantity: { decrement: line.quantity } },
          });
        }
      }

      return created;
    });

    return ok({ sale }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
