import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole, HttpError } from "@/lib/auth";
import { ok, toErrorResponse } from "@/lib/api";

const schema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
});

// Folds one vendor directory entry into another: every product, purchase
// order, bill, and historical sale line recorded under the source vendor's
// name is renamed to the target's — unlike a per-product vendor correction,
// a name merge means they were always the same vendor, so history is
// rewritten too, not left as-is. The source's contact details fill in
// whatever the target is missing (never overwriting what's already there),
// and strataBuyingGroup/hasOpenAccount are kept true if either vendor had
// them set. The source vendor directory row is then deleted.
export async function POST(req: NextRequest) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const { sourceId, targetId } = schema.parse(await req.json());
    if (sourceId === targetId) {
      throw new HttpError(400, "Choose two different vendors to merge.");
    }

    const result = await prisma.$transaction(async (tx) => {
      const [source, target] = await Promise.all([
        tx.vendor.findUnique({ where: { id: sourceId } }),
        tx.vendor.findUnique({ where: { id: targetId } }),
      ]);
      if (!source) throw new HttpError(404, "Source vendor not found");
      if (!target) throw new HttpError(404, "Target vendor not found");

      const [products, purchaseOrders, bills, saleItems, expenses] = await Promise.all([
        tx.product.updateMany({ where: { vendor: source.name }, data: { vendor: target.name } }),
        tx.purchaseOrder.updateMany({ where: { vendor: source.name }, data: { vendor: target.name } }),
        tx.bill.updateMany({ where: { vendor: source.name }, data: { vendor: target.name } }),
        tx.saleItem.updateMany({
          where: { vendorSnapshot: source.name },
          data: { vendorSnapshot: target.name },
        }),
        // Only expenses actually tied to a PO/bill — payee is free text used
        // for landlords/utilities too, so a plain name match elsewhere is
        // left alone rather than risk renaming an unrelated payee.
        tx.expense.updateMany({
          where: { payee: source.name, OR: [{ poId: { not: null } }, { billId: { not: null } }] },
          data: { payee: target.name },
        }),
      ]);

      const updated = await tx.vendor.update({
        where: { id: targetId },
        data: {
          contact: target.contact || source.contact,
          email: target.email || source.email,
          phone: target.phone || source.phone,
          address: target.address || source.address,
          notes: target.notes || source.notes,
          freightMinimumCents: target.freightMinimumCents || source.freightMinimumCents,
          rebateBps: target.rebateBps || source.rebateBps,
          strataBuyingGroup: target.strataBuyingGroup || source.strataBuyingGroup,
          hasOpenAccount: target.hasOpenAccount || source.hasOpenAccount,
        },
      });

      await tx.vendor.delete({ where: { id: sourceId } });

      return {
        vendor: updated,
        sourceName: source.name,
        counts: {
          products: products.count,
          purchaseOrders: purchaseOrders.count,
          bills: bills.count,
          saleItems: saleItems.count,
          expenses: expenses.count,
        },
      };
    });

    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
