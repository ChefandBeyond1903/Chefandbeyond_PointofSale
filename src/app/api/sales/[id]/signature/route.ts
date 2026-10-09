import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, requireScopedRole, scopeStoreId, type ScopedUser } from "@/lib/scope";
import { supabaseAdmin } from "@/lib/supabase";
import {
  DELIVERY_SIGNATURE_BUCKET,
  ensureDeliverySignatureBucket,
} from "@/lib/storage";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024; // 2 MB — plenty for a traced signature

async function loadScopedSale(id: string, actor: ScopedUser) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    select: {
      id: true,
      storeId: true,
      deliverySignaturePath: true,
      deliverySignedAt: true,
      deliverySignedName: true,
    },
  });
  if (!sale) throw new HttpError(404, "Sale not found");
  const scopedStore = scopeStoreId(actor);
  if (scopedStore && sale.storeId !== scopedStore) throw new HttpError(404, "Sale not found");
  return sale;
}

// A time-limited link to view the customer's delivery signature, if any.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const sale = await loadScopedSale(id, actor);
    if (!sale.deliverySignaturePath) {
      return ok({ signatureUrl: null, signedAt: null, signedByName: "" });
    }
    const { data, error } = await supabaseAdmin()
      .storage.from(DELIVERY_SIGNATURE_BUCKET)
      .createSignedUrl(sale.deliverySignaturePath, 300);
    if (error || !data) throw new HttpError(500, "Could not create a view link");
    return ok({
      signatureUrl: data.signedUrl,
      signedAt: sale.deliverySignedAt?.toISOString() ?? null,
      signedByName: sale.deliverySignedName,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Capture (or replace) the customer's signature. Any signed-in staff can do
// this — it happens in person at drop-off, not just for managers.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    const sale = await loadScopedSale(id, actor);

    const body = await req.json();
    const dataUrl = typeof body?.dataUrl === "string" ? body.dataUrl : "";
    const signedByName =
      typeof body?.signedByName === "string" ? body.signedByName.trim().slice(0, 120) : "";
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new HttpError(400, "A signature is required.");
    const buffer = Buffer.from(match[1], "base64");
    if (buffer.length === 0) throw new HttpError(400, "A signature is required.");
    if (buffer.length > MAX_SIGNATURE_BYTES) throw new HttpError(400, "Signature image is too large.");

    await ensureDeliverySignatureBucket();
    const key = `${id}/${Date.now()}.png`;
    const admin = supabaseAdmin();
    const { error } = await admin.storage
      .from(DELIVERY_SIGNATURE_BUCKET)
      .upload(key, buffer, { contentType: "image/png", upsert: false });
    if (error) throw new HttpError(500, `Upload failed: ${error.message}`);

    await prisma.sale.update({
      where: { id },
      data: { deliverySignaturePath: key, deliverySignedAt: new Date(), deliverySignedName: signedByName },
    });

    // Best-effort cleanup of the signature we just replaced (re-sign case).
    if (sale.deliverySignaturePath && sale.deliverySignaturePath !== key) {
      await admin.storage.from(DELIVERY_SIGNATURE_BUCKET).remove([sale.deliverySignaturePath]);
    }

    return ok({ ok: true }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Remove the signature — reserved to managers/admins since it's proof the
// customer received the goods.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    const sale = await loadScopedSale(id, actor);
    if (sale.deliverySignaturePath) {
      await supabaseAdmin()
        .storage.from(DELIVERY_SIGNATURE_BUCKET)
        .remove([sale.deliverySignaturePath]);
    }
    await prisma.sale.update({
      where: { id },
      data: { deliverySignaturePath: "", deliverySignedAt: null, deliverySignedName: "" },
    });
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
