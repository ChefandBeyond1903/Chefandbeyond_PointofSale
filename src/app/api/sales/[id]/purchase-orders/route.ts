import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedRole, scopeStoreId } from "@/lib/scope";
import { purchaseOrderCreateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

// Create a purchase order for one vendor from the items on this sale/invoice.
// PO number = invoice number + a letter, one per vendor, A-Z by vendor name.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireScopedRole("CASHIER", "MANAGER", "ADMIN");
    const { id } = await params;
    const body = purchaseOrderCreateSchema.parse(await req.json());

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { items: true, purchaseOrders: { select: { vendor: true } } },
    });
    if (!sale) throw new HttpError(404, "Invoice not found");

    const scoped = scopeStoreId(user);
    if (scoped && sale.storeId !== scoped) throw new HttpError(404, "Invoice not found");

    if (sale.purchaseOrders.some((po) => po.vendor === body.vendor)) {
      throw new HttpError(409, `A purchase order for "${body.vendor}" already exists on this invoice`);
    }

    const vendorItems = sale.items.filter((it) => (it.vendorSnapshot || "") === body.vendor);
    if (vendorItems.length === 0) {
      throw new HttpError(400, `No items from "${body.vendor}" on this invoice`);
    }

    // Letter suffix: this vendor's position among all distinct vendors on the sale, A-Z.
    const distinctVendors = [
      ...new Set(sale.items.map((it) => it.vendorSnapshot || "").filter(Boolean)),
    ].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const index = distinctVendors.indexOf(body.vendor);
    if (index < 0) throw new HttpError(400, `"${body.vendor}" is not a vendor on this invoice`);
    const poNumber = `${sale.number}${String.fromCharCode(65 + index)}`;

    // Merge this vendor's sale lines by product (sum quantities on the invoice).
    const available = new Map<
      string,
      { productId: string; nameSnapshot: string; skuSnapshot: string; quantity: number; unitCostCents: number }
    >();
    for (const it of vendorItems) {
      const prev = available.get(it.productId);
      if (prev) prev.quantity += it.quantity;
      else
        available.set(it.productId, {
          productId: it.productId,
          nameSnapshot: it.nameSnapshot,
          skuSnapshot: it.skuSnapshot,
          quantity: it.quantity,
          unitCostCents: it.unitCostCents,
        });
    }

    // If specific items were chosen, keep only those, using the requested
    // quantity clamped to what's on the invoice.
    let lines = [...available.values()];
    if (body.items && body.items.length > 0) {
      const picked = new Map(body.items.map((i) => [i.productId, i.quantity]));
      for (const pid of picked.keys()) {
        if (!available.has(pid)) {
          throw new HttpError(400, `A chosen item is not from "${body.vendor}" on this invoice`);
        }
      }
      lines = lines
        .filter((l) => picked.has(l.productId))
        .map((l) => ({ ...l, quantity: Math.min(picked.get(l.productId)!, l.quantity) }));
      if (lines.length === 0) throw new HttpError(400, "No items selected for this purchase order");
    }

    const items = lines.map((l) => ({
      ...l,
      lineCostCents: l.unitCostCents * l.quantity,
    }));
    const subtotalCents = items.reduce((s, l) => s + l.lineCostCents, 0);

    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber,
        vendor: body.vendor,
        status: "OPEN",
        subtotalCents,
        note: body.note,
        saleId: sale.id,
        storeId: sale.storeId,
        createdById: user.id,
        items: { create: items },
      },
      include: { items: true, createdBy: { select: { id: true, name: true } } },
    });

    return ok({ purchaseOrder: po }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
