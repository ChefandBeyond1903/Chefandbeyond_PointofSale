import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, requireScopedRole, scopeStoreId } from "@/lib/scope";
import { billUpdateSchema } from "@/lib/validation";
import { parseDateInput } from "@/lib/date";
import { ensureVendor } from "@/lib/vendors";
import { earlyPayDiscountCents, syncBillFeeExpenses } from "@/lib/billFees";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

async function loadScoped(id: string, actor: Awaited<ReturnType<typeof requireScopedUser>>) {
  const bill = await prisma.bill.findUnique({
    where: { id },
    select: { id: true, storeId: true, poId: true },
  });
  const scoped = scopeStoreId(actor);
  if (!bill || (scoped && bill.storeId !== scoped)) throw new HttpError(404, "Bill not found");
  return bill;
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    await loadScoped(id, actor);
    const bill = await prisma.bill.findUnique({
      where: { id },
      include: {
        items: true,
        po: { select: { id: true, poNumber: true } },
        store: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    return ok({ bill });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    await loadScoped(id, actor);
    const body = billUpdateSchema.parse(await req.json());

    const data: Record<string, unknown> = {};
    if (body.billNumber !== undefined) data.billNumber = body.billNumber;
    if (body.vendor !== undefined) {
      data.vendor = body.vendor;
      // Keep the Vendors directory in sync with whatever gets put on a bill.
      await ensureVendor(body.vendor);
    }
    if (body.terms !== undefined) data.terms = body.terms;
    if (body.memo !== undefined) data.memo = body.memo;
    if (body.billDate !== undefined) data.billDate = body.billDate ? parseDateInput(body.billDate) : new Date();
    if (body.dueDate !== undefined) data.dueDate = body.dueDate ? parseDateInput(body.dueDate) : null;
    if (body.status !== undefined) {
      data.status = body.status;
      data.paidAt = body.status === "PAID" ? new Date() : null;
    }
    if (body.paymentMethod !== undefined) data.paymentMethod = body.paymentMethod;
    if (body.shippingCents !== undefined) data.shippingCents = body.shippingCents;
    if (body.minOrderFeeCents !== undefined) data.minOrderFeeCents = body.minOrderFeeCents;
    if (body.dropShipFeeCents !== undefined) data.dropShipFeeCents = body.dropShipFeeCents;
    if (body.earlyPayDiscountBps !== undefined) data.earlyPayDiscountBps = body.earlyPayDiscountBps;
    if (body.vendorCreditCents !== undefined) data.vendorCreditCents = body.vendorCreditCents;
    const adjustsTotal =
      body.shippingCents !== undefined ||
      body.minOrderFeeCents !== undefined ||
      body.dropShipFeeCents !== undefined ||
      body.earlyPayDiscountBps !== undefined ||
      body.vendorCreditCents !== undefined;

    const bill = await prisma.$transaction(async (tx) => {
      const current = await tx.bill.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!current) throw new HttpError(404, "Bill not found");

      let qtyChanged = false;
      if (body.lines && body.lines.length > 0) {
        const byId = new Map(current.items.map((it) => [it.id, it]));
        for (const line of body.lines) {
          const it = byId.get(line.id);
          if (!it) throw new HttpError(400, "A line isn't on this bill");
          const deltaQty = line.quantity - it.quantity;
          await tx.billItem.update({
            where: { id: it.id },
            data: {
              quantity: line.quantity,
              unitCostCents: line.unitCostCents,
              lineCostCents: line.quantity * line.unitCostCents,
            },
          });
          // A "Copy to bill" entry (receivedItems: false) never bumped
          // receiving in the first place — editing its quantity shouldn't
          // either. Nor should editing while the bill is reopened (its
          // received effect is currently reversed) — the corrected
          // quantities get applied in full when it's marked paid again.
          if (deltaQty !== 0 && current.receivedItems && current.inventoryApplied) {
            qtyChanged = true;
            // Keep the PO's received count and store stock in step with the fix.
            if (it.poItemId) {
              await tx.purchaseOrderItem.update({
                where: { id: it.poItemId },
                data: { receivedQuantity: { increment: deltaQty } },
              });
            }
            if (it.productId && current.storeId) {
              await tx.storeInventory.upsert({
                where: {
                  productId_storeId: { productId: it.productId, storeId: current.storeId },
                },
                create: {
                  productId: it.productId,
                  storeId: current.storeId,
                  quantity: deltaQty,
                },
                update: { quantity: { increment: deltaQty } },
              });
            }
          }
        }
      }

      // Recompute the payable total when lines or any fee / discount / credit
      // changed. Legacy PO tax and logged "other cost" expenses are folded
      // into subtotalCents at creation but have no field of their own, so
      // preserve whatever portion of the current total the items, fees,
      // discount and credit don't account for.
      if ((body.lines && body.lines.length > 0) || adjustsTotal) {
        const originalItemsCents = current.items.reduce((s, it) => s + it.lineCostCents, 0);
        const legacyExtraCents =
          current.subtotalCents -
          originalItemsCents -
          (current.shippingCents + current.minOrderFeeCents + current.dropShipFeeCents) +
          earlyPayDiscountCents(originalItemsCents, current.earlyPayDiscountBps) +
          current.vendorCreditCents;
        const fresh = await tx.billItem.findMany({
          where: { billId: id },
          select: { lineCostCents: true },
        });
        const itemsCents = fresh.reduce((s, l) => s + l.lineCostCents, 0);
        const num = (
          k:
            | "shippingCents"
            | "minOrderFeeCents"
            | "dropShipFeeCents"
            | "earlyPayDiscountBps"
            | "vendorCreditCents",
        ) => (data[k] as number | undefined) ?? current[k];
        data.subtotalCents =
          itemsCents +
          legacyExtraCents +
          num("shippingCents") +
          num("minOrderFeeCents") +
          num("dropShipFeeCents") -
          earlyPayDiscountCents(itemsCents, num("earlyPayDiscountBps")) -
          num("vendorCreditCents");
      }

      // Reopening a PAID bill that actually received goods reverses that
      // receipt (so it isn't sitting double-counted while something about
      // the bill gets fixed); marking it PAID again re-applies it using
      // whatever quantities are on the bill at that moment. A no-op if
      // nothing about the lines changed in between.
      if (body.status !== undefined && current.receivedItems && current.storeId) {
        const linesNow =
          body.lines && body.lines.length > 0
            ? await tx.billItem.findMany({
                where: { billId: id },
                select: { poItemId: true, productId: true, quantity: true },
              })
            : current.items;

        if (body.status === "OPEN" && current.status !== "OPEN" && current.inventoryApplied) {
          for (const it of linesNow) {
            if (it.poItemId) {
              await tx.purchaseOrderItem.update({
                where: { id: it.poItemId },
                data: { receivedQuantity: { decrement: it.quantity } },
              });
            }
            if (it.productId) {
              await tx.storeInventory.upsert({
                where: { productId_storeId: { productId: it.productId, storeId: current.storeId } },
                create: { productId: it.productId, storeId: current.storeId, quantity: -it.quantity },
                update: { quantity: { decrement: it.quantity } },
              });
            }
          }
          data.inventoryApplied = false;
          qtyChanged = true;
        } else if (body.status === "PAID" && current.status !== "PAID" && !current.inventoryApplied) {
          for (const it of linesNow) {
            if (it.poItemId) {
              await tx.purchaseOrderItem.update({
                where: { id: it.poItemId },
                data: { receivedQuantity: { increment: it.quantity } },
              });
            }
            if (it.productId) {
              await tx.storeInventory.upsert({
                where: { productId_storeId: { productId: it.productId, storeId: current.storeId } },
                create: { productId: it.productId, storeId: current.storeId, quantity: it.quantity },
                update: { quantity: { increment: it.quantity } },
              });
            }
          }
          data.inventoryApplied = true;
          qtyChanged = true;
        }
      }

      const updated = await tx.bill.update({
        where: { id },
        data,
        include: {
          items: true,
          po: { select: { id: true, poNumber: true } },
          store: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });

      await syncBillFeeExpenses(tx, updated, actor.id);

      // Roll the linked PO's status forward/back to match the new received qtys.
      if (qtyChanged && current.poId) {
        const po = await tx.purchaseOrder.findUnique({
          where: { id: current.poId },
          select: { status: true, items: { select: { quantity: true, receivedQuantity: true } } },
        });
        const items = po?.items ?? [];
        const anyReceived = items.some((i) => i.receivedQuantity > 0);
        const allReceived =
          items.length > 0 && items.every((i) => i.receivedQuantity >= i.quantity);
        const resettable =
          po?.status === "PARTIAL" || po?.status === "RECEIVED" || po?.status === "NOT_RECEIVED";
        const status = allReceived
          ? "RECEIVED"
          : anyReceived
            ? "PARTIAL"
            : resettable
              ? "OPEN"
              : (po?.status ?? "OPEN");
        await tx.purchaseOrder.update({ where: { id: current.poId }, data: { status } });
      }

      return updated;
    });

    return ok({ bill });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Deleting a bill reverses its receipt — PO line receivedQuantity and store
// inventory both move back by the billed amounts — but only if creating this
// bill actually received those items in the first place (see
// Bill.receivedItems) AND that receipt is still currently reflected in
// inventory (see Bill.inventoryApplied — a reopened bill already reversed
// it, so deleting it from there must not reverse it a second time).
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    await loadScoped(id, actor);

    const bill = await prisma.bill.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!bill) throw new HttpError(404, "Bill not found");

    await prisma.$transaction(async (tx) => {
      if (bill.receivedItems && bill.inventoryApplied) {
        for (const it of bill.items) {
          if (it.poItemId) {
            await tx.purchaseOrderItem.update({
              where: { id: it.poItemId },
              data: { receivedQuantity: { decrement: it.quantity } },
            });
          }
          if (it.productId && bill.storeId) {
            await tx.storeInventory.upsert({
              where: { productId_storeId: { productId: it.productId, storeId: bill.storeId } },
              create: { productId: it.productId, storeId: bill.storeId, quantity: -it.quantity },
              update: { quantity: { decrement: it.quantity } },
            });
          }
        }
      }

      await tx.bill.delete({ where: { id } });

      if (bill.poId) {
        const fresh = await tx.purchaseOrder.findUnique({
          where: { id: bill.poId },
          select: { status: true, items: { select: { quantity: true, receivedQuantity: true } } },
        });
        const items = fresh?.items ?? [];
        const anyReceived = items.some((i) => i.receivedQuantity > 0);
        const allReceived =
          items.length > 0 && items.every((i) => i.receivedQuantity >= i.quantity);
        const resettable =
          fresh?.status === "PARTIAL" ||
          fresh?.status === "RECEIVED" ||
          fresh?.status === "NOT_RECEIVED";
        const status = allReceived
          ? "RECEIVED"
          : anyReceived
            ? "PARTIAL"
            : resettable
              ? "OPEN"
              : (fresh?.status ?? "OPEN");
        await tx.purchaseOrder.update({ where: { id: bill.poId }, data: { status } });
      }
    });

    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
