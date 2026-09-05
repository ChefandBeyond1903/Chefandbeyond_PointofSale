import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, HttpError } from "@/lib/auth";
import { requireScopedUser } from "@/lib/scope";
import { productUpdateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";
import { ensureVendor } from "@/lib/vendors";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const [product, stores] = await Promise.all([
      prisma.product.findUnique({
        where: { id },
        include: {
          category: { select: { id: true, name: true } },
          inventory: { select: { storeId: true, quantity: true } },
        },
      }),
      prisma.store.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    if (!product) throw new HttpError(404, "Product not found");

    // On-hand for every active store (0 where there's no row yet).
    const qtyByStore = new Map(product.inventory.map((i) => [i.storeId, i.quantity]));
    const storeStock = stores.map((s) => ({
      storeId: s.id,
      storeName: s.name,
      quantity: qtyByStore.get(s.id) ?? 0,
    }));

    // Stores whose on-hand this user may set from here: an admin any store,
    // a manager only their own, a cashier none.
    const editableStoreIds =
      actor.role === "ADMIN"
        ? stores.map((s) => s.id)
        : actor.role === "MANAGER" && actor.storeId
          ? [actor.storeId]
          : [];

    const { inventory: _inventory, ...rest } = product;
    void _inventory;
    return ok({ product: rest, storeStock, editableStoreIds });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireRole("MANAGER", "ADMIN");
    const { id } = await params;
    const data = productUpdateSchema.parse(await req.json());
    // Only an admin may change the resale floor — silently drop it otherwise.
    if (actor.role !== "ADMIN") delete data.umrpCents;

    // Enforce: sticker price may never sit below the UMRP. Fall back to the
    // stored values for whichever of the two isn't part of this update.
    if (data.priceCents !== undefined || data.umrpCents !== undefined) {
      const existing = await prisma.product.findUnique({
        where: { id },
        select: { priceCents: true, umrpCents: true },
      });
      if (!existing) throw new HttpError(404, "Product not found");
      const price = data.priceCents ?? existing.priceCents;
      const umrp = data.umrpCents ?? existing.umrpCents;
      if (umrp > 0 && price < umrp) {
        throw new HttpError(400, "Price can't be below the minimum resale price (UMRP)");
      }
    }

    const product = await prisma.product.update({
      where: { id },
      data,
      include: { category: { select: { id: true, name: true } } },
    });
    if (data.vendor !== undefined) await ensureVendor(product.vendor);
    // Favoriting a product for the register also favorites its category, so
    // the category shows up as a tile there without a separate step.
    if (data.favorite === true && product.categoryId) {
      await prisma.category.update({
        where: { id: product.categoryId },
        data: { favorite: true },
      });
    }
    return ok({ product });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Soft delete: keeps sale history intact.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const { id } = await params;
    const product = await prisma.product.update({
      where: { id },
      data: { active: false },
    });
    return ok({ product });
  } catch (err) {
    return toErrorResponse(err);
  }
}
