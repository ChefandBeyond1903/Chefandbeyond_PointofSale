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
    const take = Math.min(Number(searchParams.get("take") ?? 50), 500);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const cashierId = searchParams.get("cashierId")?.trim();
    const number = Number(searchParams.get("number"));
    const q = searchParams.get("q")?.trim();
    const status = searchParams.get("status")?.trim().toUpperCase();

    const where: Prisma.SaleWhereInput = {};
    // Non-admins only ever see their own store's sales; an admin may narrow to
    // one store with ?storeId=.
    const scopedStore = scopeStoreId(actor);
    const storeParam = searchParams.get("storeId")?.trim();
    if (scopedStore) where.storeId = scopedStore;
    else if (storeParam) where.storeId = storeParam;
    if (cashierId) where.cashierId = cashierId;
    if (Number.isInteger(number) && number > 0) where.number = number;
    if (status && ["COMPLETED", "INVOICED", "REFUNDED", "VOIDED"].includes(status)) {
      where.status = status;
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    if (q) {
      // Free-text invoice search: match a number, or any customer snapshot.
      const asNumber = Number(q.replace(/[^0-9]/g, ""));
      const or: Prisma.SaleWhereInput[] = [
        { customerNameSnapshot: { contains: q, mode: "insensitive" } },
        { customerCompanySnapshot: { contains: q, mode: "insensitive" } },
        { customerEmailSnapshot: { contains: q, mode: "insensitive" } },
        { customerPhoneSnapshot: { contains: q, mode: "insensitive" } },
      ];
      if (Number.isInteger(asNumber) && asNumber > 0) or.push({ number: asNumber });
      where.OR = or;
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
          storeId: true,
          taxExempt: true,
          taxExemptExpiresAt: true,
          paymentTerms: true,
          storeCreditCents: true,
        },
      });
      // Customers belong to the store that created them — you can't ring a sale
      // against another store's customer.
      if (c && storeId && c.storeId && c.storeId !== storeId) {
        throw new HttpError(400, "That customer belongs to another store.");
      }
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
      { quantity: number; discountCents: number; unitPriceCents?: number; serialNumber: string }
    >();
    for (const item of body.items) {
      const prev = merged.get(item.productId);
      if (prev) {
        prev.quantity += item.quantity;
        prev.discountCents += item.discountCents;
        if (item.unitPriceCents !== undefined) prev.unitPriceCents = item.unitPriceCents;
        if (item.serialNumber) {
          prev.serialNumber = prev.serialNumber
            ? `${prev.serialNumber}, ${item.serialNumber}`
            : item.serialNumber;
        }
      } else {
        merged.set(item.productId, {
          quantity: item.quantity,
          discountCents: item.discountCents,
          unitPriceCents: item.unitPriceCents,
          serialNumber: item.serialNumber ?? "",
        });
      }
    }

    const productIds = [...merged.keys()];
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    if (products.length !== productIds.length) {
      throw new HttpError(400, "One or more products no longer exist");
    }

    // A product with no cost can't be sold — the margin would be unknowable.
    const noCost = products.filter((p) => p.costCents <= 0).map((p) => p.name);
    if (noCost.length > 0) {
      throw new HttpError(
        400,
        `Cost needs to be entered for: ${noCost.join(", ")}. Set a cost on the product before selling it.`,
      );
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

    // Normalise every way the client can send money into one list of payments.
    type Pay = {
      method: "CASH" | "CARD" | "CHECK" | "CREDIT";
      amountCents: number;
      tenderedCents: number;
      checkNumber: string;
    };
    let paymentList: Pay[] = [];
    if (body.payments && body.payments.length > 0) {
      paymentList = body.payments.map((p) => ({
        method: p.method,
        amountCents: p.amountCents,
        tenderedCents: p.tenderedCents,
        checkNumber: p.checkNumber ?? "",
      }));
    } else if (body.depositCents > 0) {
      if (!body.depositMethod) throw new HttpError(400, "Choose how the deposit was paid.");
      paymentList = [
        {
          method: body.depositMethod,
          amountCents: Math.min(body.depositCents, total),
          tenderedCents: body.tenderedCents,
          checkNumber: body.checkNumber ?? "",
        },
      ];
    } else if (!isTermsInvoice) {
      if (!body.paymentMethod) throw new HttpError(400, "Choose a payment method.");
      paymentList = [
        {
          method: body.paymentMethod,
          amountCents: total,
          tenderedCents: body.tenderedCents,
          checkNumber: body.checkNumber ?? "",
        },
      ];
    }
    if (paymentList.some((p) => p.method === "CHECK" && !p.checkNumber.trim())) {
      throw new HttpError(400, "Enter the check number for the check payment.");
    }

    let paidNowCents = 0;
    let tenderedCents = 0;
    let changeCents = 0;
    let creditToSpend = 0;
    for (const p of paymentList) {
      paidNowCents += p.amountCents;
      if (p.method === "CREDIT") creditToSpend += p.amountCents;
      if (p.method === "CASH") {
        const tend = Math.max(p.tenderedCents, p.amountCents);
        tenderedCents += tend;
        changeCents += Math.max(0, tend - p.amountCents);
      } else {
        tenderedCents += p.amountCents;
      }
    }
    if (paidNowCents > total) {
      throw new HttpError(400, "Payments add up to more than the order total.");
    }
    if (paidNowCents < total && !isTermsInvoice && !body.customerId && !body.customer) {
      throw new HttpError(400, "Add a customer to leave a balance on the sale.");
    }
    if (creditToSpend > 0) {
      if (!body.customerId) throw new HttpError(400, "Store credit needs an existing customer.");
      if (creditToSpend > customerStoreCreditCents) {
        throw new HttpError(
          400,
          `Only ${(customerStoreCreditCents / 100).toFixed(2)} of store credit is available.`,
        );
      }
    }

    const settledNow = paidNowCents >= total;
    // "Method" recorded on the sale header — SPLIT when more than one was used.
    const methodsUsed = [...new Set(paymentList.map((p) => p.method))];
    const payMethod = methodsUsed.length === 1 ? methodsUsed[0] : methodsUsed.length > 1 ? "SPLIT" : "";
    const openShift = paymentList.some((p) => p.method !== "CREDIT")
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
      let cSnap = { name: "", company: "", email: "", phone: "", address: "" };
      if (body.customerId) {
        const c = await tx.customer.findUnique({ where: { id: body.customerId } });
        if (!c) throw new HttpError(400, "Customer not found");
        customerId = c.id;
        cSnap = { name: c.name, company: c.company, email: c.email, phone: c.phone, address: c.address };
      } else if (body.customer) {
        const inp = body.customer;
        // Match / create within the selling store only — each store keeps its
        // own customer list.
        const scopeWhere = storeId ? { storeId } : { storeId: null };
        const existing = await tx.customer.findFirst({
          where: {
            ...scopeWhere,
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
          cSnap = { name: c.name, company: c.company, email: c.email, phone: c.phone, address: c.address };
        } else {
          const c = await tx.customer.create({
            data: {
              name: inp.name,
              email: inp.email,
              phone: inp.phone,
              address: inp.address,
              company: inp.company,
              storeId: storeId ?? null,
            },
          });
          customerId = c.id;
          cSnap = { name: c.name, company: c.company, email: c.email, phone: c.phone, address: c.address };
        }
      }

      const created = await tx.sale.create({
        data: {
          number,
          status: settledNow ? "COMPLETED" : "INVOICED",
          paidAt: settledNow ? new Date() : null,
          checkNumber:
            payMethod === "CHECK" ? (paymentList[0]?.checkNumber ?? "") : "",
          subtotalCents: computed.subtotalCents,
          listSubtotalCents,
          discountCents: computed.discountCents,
          taxCents: computed.taxCents,
          taxRateBps: computed.taxRateBps,
          shippingCents: computed.shippingCents,
          totalCents: computed.totalCents,
          paymentMethod: payMethod,
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
          customerCompanySnapshot: cSnap.company,
          customerEmailSnapshot: cSnap.email,
          customerPhoneSnapshot: cSnap.phone,
          customerAddressSnapshot: cSnap.address,
          items: {
            create: computed.lines.map((l) => ({
              productId: l.productId,
              nameSnapshot: l.nameSnapshot,
              skuSnapshot: meta.get(l.productId)?.sku ?? "",
              serialNumber: merged.get(l.productId)?.serialNumber ?? "",
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

      // One SalePayment row per tender so the till and the customer-deposit /
      // store-credit balances reconcile precisely.
      for (const p of paymentList) {
        await tx.salePayment.create({
          data: {
            saleId: created.id,
            amountCents: p.amountCents,
            method: p.method,
            checkNumber: p.checkNumber,
            paidAt: new Date(),
            isDeposit: !settledNow,
            createdById: user.id,
            shiftId: p.method === "CREDIT" ? null : (openShift?.id ?? null),
          },
        });
      }
      // Store credit spent draws the customer's balance down.
      if (creditToSpend > 0 && customerId) {
        await tx.customer.update({
          where: { id: customerId },
          data: { storeCreditCents: { decrement: creditToSpend } },
        });
        await tx.storeCreditEntry.create({
          data: {
            customerId,
            amountCents: -creditToSpend,
            kind: "SPEND",
            reason: `Sale #${number}`,
            saleId: created.id,
            createdById: user.id,
          },
        });
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
