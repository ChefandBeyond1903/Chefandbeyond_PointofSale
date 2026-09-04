import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, requireScopedRole, scopeStoreId } from "@/lib/scope";
import { salePaymentSchema, saleEditSchema } from "@/lib/validation";
import { computeSale, type PricedInput } from "@/lib/sale";
import { formatMoney } from "@/lib/money";
import { parseEventDate } from "@/lib/date";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        items: true,
        payments: {
          orderBy: { paidAt: "asc" },
          include: { createdBy: { select: { id: true, name: true } } },
        },
        refunds: {
          orderBy: { refundedAt: "asc" },
          include: { createdBy: { select: { id: true, name: true } } },
        },
        cashier: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        customer: true,
        purchaseOrders: {
          orderBy: { poNumber: "asc" },
          include: { items: true, createdBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!sale) throw new HttpError(404, "Sale not found");

    const scopedStore = scopeStoreId(actor);
    if (scopedStore && sale.storeId !== scopedStore) {
      throw new HttpError(404, "Sale not found");
    }

    // Group line items by vendor so the UI can offer one PO per vendor.
    const vendorMap = new Map<string, { vendor: string; quantity: number; costCents: number }>();
    for (const it of sale.items) {
      const v = it.vendorSnapshot || "";
      const g = vendorMap.get(v) ?? { vendor: v, quantity: 0, costCents: 0 };
      g.quantity += it.quantity;
      g.costCents += it.unitCostCents * it.quantity;
      vendorMap.set(v, g);
    }
    const vendors = [...vendorMap.values()]
      .filter((g) => g.vendor)
      .sort((a, b) => a.vendor.toLowerCase().localeCompare(b.vendor.toLowerCase()))
      .map((g, i) => ({
        ...g,
        letter: String.fromCharCode(65 + i),
        poNumber: `${sale.number}${String.fromCharCode(65 + i)}`,
        hasPo: sale.purchaseOrders.some((po) => po.vendor === g.vendor),
      }));
    const unassignedQty = vendorMap.get("")?.quantity ?? 0;

    return ok({ sale, vendors, unassignedQty });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PATCH does two jobs:
//  - a body with `paymentMethod` records a payment against an INVOICED sale;
//  - anything else edits the invoice's note / bill-to details (manager+).
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const raw = await req.json();
    const { id } = await params;

    // --- edit the note / bill-to details / items ---
    if (!raw || typeof raw !== "object" || !("paymentMethod" in raw)) {
      const editor = await requireScopedRole("MANAGER", "ADMIN");
      const scoped = scopeStoreId(editor);
      const cur = await prisma.sale.findUnique({
        where: { id },
        select: {
          storeId: true,
          status: true,
          number: true,
          taxRateBps: true,
          shippingCents: true,
          customerTaxExemptSnapshot: true,
          amountPaidCents: true,
          refundedCents: true,
          paidAt: true,
          items: { select: { productId: true, quantity: true } },
        },
      });
      if (!cur || (scoped && cur.storeId !== scoped)) throw new HttpError(404, "Invoice not found");
      const fields = saleEditSchema.parse(raw);

      // A reassigned salesperson must be an active user — in the editor's store
      // unless the editor is an admin (who may credit anyone).
      if (fields.salespersonId !== undefined) {
        const sp = await prisma.user.findFirst({
          where: {
            id: fields.salespersonId,
            active: true,
            ...(editor.role === "ADMIN" ? {} : { storeId: cur.storeId ?? "__none__" }),
          },
          select: { id: true },
        });
        if (!sp) throw new HttpError(400, "That salesperson isn't available for this invoice.");
      }

      const data: Record<string, unknown> = {};
      for (const k of Object.keys(fields) as (keyof typeof fields)[]) {
        if (k === "items") continue;
        if (fields[k] !== undefined) data[k] = fields[k];
      }

      let itemsCreate: Record<string, unknown>[] | null = null;
      let oldItems: { productId: string; quantity: number }[] = [];
      if (fields.items) {
        if (cur.status === "REFUNDED" || cur.status === "VOIDED") {
          throw new HttpError(400, `Can't edit items on a ${cur.status.toLowerCase()} invoice.`);
        }

        // Merge duplicate product lines defensively (same as creating a sale).
        const merged = new Map<
          string,
          { quantity: number; discountCents: number; unitPriceCents?: number; serialNumber: string }
        >();
        for (const item of fields.items) {
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

        // Same rules as ringing a sale: no cost, no sale; never below UMRP.
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
          priced.push({
            productId: p.id,
            name: p.name,
            unitPriceCents: line.unitPriceCents ?? p.priceCents,
            quantity: line.quantity,
            lineDiscountCents: line.discountCents,
          });
        }

        const taxRateBps = cur.customerTaxExemptSnapshot ? 0 : cur.taxRateBps;
        const computed = computeSale(priced, 0, taxRateBps, cur.shippingCents);

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

        // The new total can't drop below what's already been collected /
        // refunded — that would leave the invoice's numbers inconsistent.
        // Issue a refund first to reduce it further.
        const netCollected = cur.amountPaidCents - cur.refundedCents;
        if (computed.totalCents < netCollected || computed.totalCents < cur.refundedCents) {
          const floor = Math.max(netCollected, cur.refundedCents);
          throw new HttpError(
            400,
            `This invoice has ${formatMoney(floor)} collected — the new total can't be less than that. ` +
              `Issue a refund first if you need to reduce it further.`,
          );
        }

        const settled = cur.amountPaidCents >= computed.totalCents;
        data.subtotalCents = computed.subtotalCents;
        data.listSubtotalCents = listSubtotalCents;
        data.discountCents = computed.discountCents;
        data.taxCents = computed.taxCents;
        data.taxRateBps = computed.taxRateBps;
        data.totalCents = computed.totalCents;
        data.status = settled ? "COMPLETED" : "INVOICED";
        data.paidAt = settled ? (cur.paidAt ?? new Date()) : null;

        const meta = new Map(
          products.map((p) => [p.id, { sku: p.sku, vendor: p.vendor, costCents: p.costCents }]),
        );
        itemsCreate = computed.lines.map((l) => ({
          productId: l.productId,
          nameSnapshot: l.nameSnapshot,
          skuSnapshot: meta.get(l.productId)?.sku ?? "",
          vendorSnapshot: meta.get(l.productId)?.vendor ?? "",
          serialNumber: merged.get(l.productId)?.serialNumber ?? "",
          unitPriceCents: l.unitPriceCents,
          unitCostCents: meta.get(l.productId)?.costCents ?? 0,
          quantity: l.quantity,
          discountCents: l.discountCents,
          taxRateBps: l.taxRateBps,
          lineTotalCents: l.lineTotalCents,
        }));
        oldItems = cur.items;
      }

      const sale = await prisma.$transaction(async (tx) => {
        if (itemsCreate) {
          // Re-square inventory: put back what the old lines drew down, then
          // draw down what the new lines need (may net to nothing per product).
          if (cur.storeId) {
            const allIds = [...new Set([...oldItems.map((i) => i.productId), ...itemsCreate.map((l) => l.productId as string)])];
            const tracked = new Set(
              (
                await tx.product.findMany({
                  where: { id: { in: allIds }, trackStock: true },
                  select: { id: true },
                })
              ).map((p) => p.id),
            );
            for (const it of oldItems) {
              if (!tracked.has(it.productId)) continue;
              await tx.storeInventory.upsert({
                where: { productId_storeId: { productId: it.productId, storeId: cur.storeId } },
                create: { productId: it.productId, storeId: cur.storeId, quantity: it.quantity },
                update: { quantity: { increment: it.quantity } },
              });
            }
            for (const l of itemsCreate) {
              const productId = l.productId as string;
              const quantity = l.quantity as number;
              if (!tracked.has(productId)) continue;
              await tx.storeInventory.upsert({
                where: { productId_storeId: { productId, storeId: cur.storeId } },
                create: { productId, storeId: cur.storeId, quantity: -quantity },
                update: { quantity: { decrement: quantity } },
              });
            }
          }
          await tx.saleItem.deleteMany({ where: { saleId: id } });
        }
        return tx.sale.update({
          where: { id },
          data: itemsCreate ? { ...data, items: { create: itemsCreate } } : data,
          include: {
            items: true,
            payments: { orderBy: { paidAt: "asc" } },
            refunds: {
              orderBy: { refundedAt: "asc" },
              include: { createdBy: { select: { id: true, name: true } } },
            },
            cashier: { select: { id: true, name: true } },
            salesperson: { select: { id: true, name: true } },
            customer: true,
          },
        });
      });
      return ok({ sale });
    }

    // --- record a payment ---
    const actor = await requireScopedUser();
    const body = salePaymentSchema.parse(raw);

    const sale = await prisma.sale.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        storeId: true,
        totalCents: true,
        amountPaidCents: true,
        customerId: true,
        number: true,
        customer: { select: { storeCreditCents: true } },
      },
    });
    if (!sale) throw new HttpError(404, "Invoice not found");
    const scoped = scopeStoreId(actor);
    if (scoped && sale.storeId !== scoped) throw new HttpError(404, "Invoice not found");
    if (sale.status !== "INVOICED") {
      throw new HttpError(400, "This invoice has already been settled.");
    }

    const balanceCents = sale.totalCents - sale.amountPaidCents;
    const amountCents = body.amountCents ?? balanceCents;
    if (amountCents < 1) throw new HttpError(400, "Enter a payment amount.");
    if (amountCents > balanceCents) {
      throw new HttpError(400, `That's more than the balance due (${balanceCents / 100}).`);
    }
    if (body.paymentMethod === "CREDIT") {
      const avail = sale.customer?.storeCreditCents ?? 0;
      if (!sale.customerId) throw new HttpError(400, "This invoice has no customer for store credit.");
      if (amountCents > avail) {
        throw new HttpError(400, `Only ${(avail / 100).toFixed(2)} of store credit is available.`);
      }
    }
    const checkNumber = (body.checkNumber ?? "").trim();
    if (body.paymentMethod === "CHECK" && !checkNumber) {
      throw new HttpError(400, "Enter the check number.");
    }

    // Never stamp a payment in the future — that would drop the sale out of
    // "up to now" report ranges (a "today" date anchors at noon UTC).
    const paidAt = parseEventDate(body.paidAt);
    const newPaidCents = sale.amountPaidCents + amountCents;
    const settled = newPaidCents >= sale.totalCents;

    let tenderedCents = amountCents;
    let changeCents = 0;
    if (body.paymentMethod === "CASH" && body.tenderedCents) {
      tenderedCents = body.tenderedCents;
      if (tenderedCents < amountCents) {
        throw new HttpError(400, "Amount tendered is less than the payment amount");
      }
      changeCents = tenderedCents - amountCents;
    }

    // Attach to whoever is recording it (their open till), so cash reconciles.
    const openShift = await prisma.shift.findFirst({
      where: { userId: actor.id, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.salePayment.create({
        data: {
          saleId: id,
          amountCents,
          method: body.paymentMethod,
          checkNumber,
          paidAt,
          isDeposit: !settled,
          createdById: actor.id,
          shiftId: openShift?.id ?? null,
        },
      });
      if (body.paymentMethod === "CREDIT" && sale.customerId) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data: { storeCreditCents: { decrement: amountCents } },
        });
        await tx.storeCreditEntry.create({
          data: {
            customerId: sale.customerId,
            amountCents: -amountCents,
            kind: "SPEND",
            reason: `Invoice #${sale.number}`,
            saleId: id,
            createdById: actor.id,
          },
        });
      }
      return tx.sale.update({
        where: { id },
        data: {
          amountPaidCents: newPaidCents,
          ...(settled
            ? {
                status: "COMPLETED",
                paidAt,
                paymentMethod: body.paymentMethod,
                checkNumber: body.paymentMethod === "CHECK" ? checkNumber : "",
                tenderedCents,
                changeCents,
                shiftId: openShift?.id ?? null,
              }
            : {}),
        },
        include: {
          items: true,
          payments: { orderBy: { paidAt: "asc" } },
          cashier: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true } },
          customer: true,
        },
      });
    });
    return ok({ sale: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Permanently delete a sale or open invoice. Admin only. Puts the sold
// quantities back into inventory, hands any store credit spent on it back to
// the customer, and cascades to line items, payments, refunds and any purchase
// orders raised from it.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    if (actor.role !== "ADMIN") throw new HttpError(403, "Only an admin can delete invoices");
    const { id } = await params;

    const sale = await prisma.sale.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        storeId: true,
        customerId: true,
        items: { select: { productId: true, quantity: true } },
        payments: { select: { method: true, amountCents: true } },
        refunds: { select: { method: true, amountCents: true } },
      },
    });
    if (!sale) throw new HttpError(404, "Invoice not found");

    // Net store credit this sale consumed: credit spent as payment, minus any
    // credit handed back via a refund. Delete un-does both.
    const creditSpent = sale.payments
      .filter((p) => p.method === "CREDIT")
      .reduce((s, p) => s + p.amountCents, 0);
    const creditRefunded = sale.refunds
      .filter((r) => r.method === "CREDIT")
      .reduce((s, r) => s + r.amountCents, 0);
    const creditToRestore = creditSpent - creditRefunded;

    await prisma.$transaction(async (tx) => {
      if (sale.storeId) {
        const ids = sale.items.map((i) => i.productId);
        const tracked = new Set(
          (
            await tx.product.findMany({
              where: { id: { in: ids }, trackStock: true },
              select: { id: true },
            })
          ).map((p) => p.id),
        );
        for (const it of sale.items) {
          if (!tracked.has(it.productId)) continue;
          await tx.storeInventory.upsert({
            where: { productId_storeId: { productId: it.productId, storeId: sale.storeId } },
            create: { productId: it.productId, storeId: sale.storeId, quantity: it.quantity },
            update: { quantity: { increment: it.quantity } },
          });
        }
      }

      if (sale.customerId && creditToRestore !== 0) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data: { storeCreditCents: { increment: creditToRestore } },
        });
        await tx.storeCreditEntry.create({
          data: {
            customerId: sale.customerId,
            amountCents: creditToRestore,
            kind: "ADJUST",
            reason: `Deleted sale #${sale.number}`,
            createdById: actor.id,
          },
        });
      }
      // Drop this sale's own credit-ledger rows (they'd dangle otherwise).
      await tx.storeCreditEntry.deleteMany({ where: { saleId: id } });

      await tx.sale.delete({ where: { id } });
    });

    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
