import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, requireScopedRole, scopeStoreId } from "@/lib/scope";
import { purchaseOrderPatchSchema } from "@/lib/validation";
import { computeSubtotalCents, itemAmountCents } from "@/lib/purchaseOrder";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

/** 404 unless the caller's store scope covers this PO. */
async function loadScoped(id: string, actor: Awaited<ReturnType<typeof requireScopedUser>>) {
  const scoped = scopeStoreId(actor);
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, select: { storeId: true } });
  if (!po || (scoped && po.storeId !== scoped)) {
    throw new HttpError(404, "Purchase order not found");
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    await loadScoped(id, actor);
    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        categoryLines: { orderBy: { sortOrder: "asc" } },
        createdBy: { select: { id: true, name: true } },
        sale: { select: { id: true, number: true, createdAt: true } },
      },
    });
    if (!po) throw new HttpError(404, "Purchase order not found");
    return ok({ purchaseOrder: po });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    await loadScoped(id, actor);
    const f = purchaseOrderPatchSchema.parse(await req.json());

    const data: Prisma.PurchaseOrderUpdateInput = {};
    const scalars = [
      "vendor", "status", "poNumber", "note", "email", "ccBcc",
      "mailingAddress", "shipTo", "shippingAddress", "shipVia", "storeName",
      "permitNumber", "messageToCustomer", "poRef", "salesRep", "mobileNumber",
      "messageToVendor", "memo",
    ] as const;
    for (const k of scalars) {
      if (f[k] !== undefined) (data as Record<string, unknown>)[k] = f[k];
    }
    if (f.tags !== undefined) data.tags = JSON.stringify(f.tags);
    if (f.poDate !== undefined) data.poDate = f.poDate ? new Date(f.poDate) : new Date();
    if (f.dueDate !== undefined) data.dueDate = f.dueDate ? new Date(f.dueDate) : null;

    const replacingLines = f.categoryLines !== undefined || f.itemLines !== undefined;

    const po = await prisma.$transaction(async (tx) => {
      if (replacingLines) {
        const current = await tx.purchaseOrder.findUnique({
          where: { id },
          include: { categoryLines: true, items: true },
        });
        if (!current) throw new HttpError(404, "Purchase order not found");

        const catLines = f.categoryLines ?? current.categoryLines.map((l) => ({
          category: l.category, description: l.description, amountCents: l.amountCents,
          customerProject: l.customerProject, klass: l.klass,
        }));
        const itemLines = f.itemLines ?? current.items.map((l) => ({
          productId: l.productId, productService: l.nameSnapshot, sku: l.skuSnapshot,
          description: l.description, quantity: l.quantity, rateCents: l.unitCostCents,
          customerProject: l.customerProject, klass: l.klass,
        }));

        if (f.categoryLines !== undefined) {
          await tx.purchaseOrderCategoryLine.deleteMany({ where: { poId: id } });
          await tx.purchaseOrderCategoryLine.createMany({
            data: f.categoryLines.map((l, i) => ({
              poId: id,
              category: l.category, description: l.description, amountCents: l.amountCents,
              customerProject: l.customerProject, klass: l.klass, sortOrder: i,
            })),
          });
        }
        if (f.itemLines !== undefined) {
          await tx.purchaseOrderItem.deleteMany({ where: { poId: id } });
          await tx.purchaseOrderItem.createMany({
            data: f.itemLines.map((l, i) => ({
              poId: id,
              productId: l.productId ?? null,
              nameSnapshot: l.productService, skuSnapshot: l.sku, description: l.description,
              quantity: l.quantity, unitCostCents: l.rateCents, lineCostCents: itemAmountCents(l),
              customerProject: l.customerProject, klass: l.klass, sortOrder: i,
            })),
          });
        }
        data.subtotalCents = computeSubtotalCents(catLines, itemLines);
      }

      return tx.purchaseOrder.update({
        where: { id },
        data,
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          categoryLines: { orderBy: { sortOrder: "asc" } },
          createdBy: { select: { id: true, name: true } },
          sale: { select: { id: true, number: true } },
        },
      });
    });

    return ok({ purchaseOrder: po });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    await loadScoped(id, actor);
    await prisma.purchaseOrder.delete({ where: { id } });
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
