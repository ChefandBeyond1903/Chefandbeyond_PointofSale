import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireScopedUser, requireScopedRole, scopeStoreId } from "@/lib/scope";
import { ok, toErrorResponse } from "@/lib/api";
import { purchaseOrderFormSchema } from "@/lib/validation";
import { computeSubtotalCents, lineCreateData, uniquePoNumber } from "@/lib/purchaseOrder";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const { searchParams } = new URL(req.url);
    const take = Math.min(Number(searchParams.get("take") ?? 100), 500);
    const vendor = searchParams.get("vendor")?.trim();
    const status = searchParams.get("status")?.trim();
    const saleId = searchParams.get("saleId")?.trim();

    const where: Prisma.PurchaseOrderWhereInput = {};
    const scopedStore = scopeStoreId(actor);
    if (scopedStore) where.storeId = scopedStore;
    if (vendor) where.vendor = vendor;
    if (status) where.status = status;
    if (saleId) where.saleId = saleId;

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      include: {
        sale: { select: { id: true, number: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });
    return ok({ purchaseOrders });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Standalone purchase order entered on the PO form (no invoice).
export async function POST(req: NextRequest) {
  try {
    const user = await requireScopedRole("CASHIER", "MANAGER", "ADMIN");
    const f = purchaseOrderFormSchema.parse(await req.json());

    const poNumber = await uniquePoNumber(f.poNumber);
    const subtotalCents = computeSubtotalCents(f.categoryLines, f.itemLines);

    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber,
        vendor: f.vendor,
        status: f.status,
        subtotalCents,
        storeId: user.storeId ?? null,
        email: f.email,
        ccBcc: f.ccBcc,
        mailingAddress: f.mailingAddress,
        shipTo: f.shipTo,
        shippingAddress: f.shippingAddress,
        poDate: f.poDate ? new Date(f.poDate) : new Date(),
        dueDate: f.dueDate ? new Date(f.dueDate) : null,
        shipVia: f.shipVia,
        storeName: f.storeName,
        permitNumber: f.permitNumber,
        messageToCustomer: f.messageToCustomer,
        poRef: f.poRef,
        salesRep: f.salesRep,
        mobileNumber: f.mobileNumber,
        tags: JSON.stringify(f.tags),
        messageToVendor: f.messageToVendor,
        memo: f.memo,
        createdById: user.id,
        ...lineCreateData(f.categoryLines, f.itemLines),
      },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        categoryLines: { orderBy: { sortOrder: "asc" } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    return ok({ purchaseOrder: po }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
