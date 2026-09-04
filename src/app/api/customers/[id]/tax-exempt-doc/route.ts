import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { requireScopedUser, requireScopedRole, assertCustomerInScope } from "@/lib/scope";
import { supabaseAdmin } from "@/lib/supabase";
import {
  TAX_EXEMPT_BUCKET,
  TAX_EXEMPT_DOC_TYPES,
  TAX_EXEMPT_DOC_MAX_BYTES,
  ensureTaxExemptBucket,
  safeFileName,
} from "@/lib/storage";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

// A time-limited download link for the customer's exemption certificate.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    await assertCustomerInScope(id, actor);
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: { taxExemptDocPath: true, taxExemptDocName: true },
    });
    if (!customer) throw new HttpError(404, "Customer not found");
    if (!customer.taxExemptDocPath) throw new HttpError(404, "No certificate on file");

    const { data, error } = await supabaseAdmin()
      .storage.from(TAX_EXEMPT_BUCKET)
      .createSignedUrl(customer.taxExemptDocPath, 120);
    if (error || !data) throw new HttpError(500, "Could not create a download link");
    return ok({ url: data.signedUrl, name: customer.taxExemptDocName });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Upload (or replace) the exemption certificate. multipart/form-data, field "file".
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    await assertCustomerInScope(id, actor);
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: { id: true, taxExemptDocPath: true },
    });
    if (!customer) throw new HttpError(404, "Customer not found");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Attach a file to upload.");
    if (!TAX_EXEMPT_DOC_TYPES.includes(file.type as (typeof TAX_EXEMPT_DOC_TYPES)[number])) {
      throw new HttpError(400, "Certificate must be a PDF, PNG, JPG, or WEBP.");
    }
    if (file.size > TAX_EXEMPT_DOC_MAX_BYTES) {
      throw new HttpError(400, "Certificate file must be 10 MB or smaller.");
    }

    await ensureTaxExemptBucket();
    const key = `${id}/${Date.now()}-${safeFileName(file.name)}`;
    const admin = supabaseAdmin();
    const { error } = await admin.storage
      .from(TAX_EXEMPT_BUCKET)
      .upload(key, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: false,
      });
    if (error) throw new HttpError(500, `Upload failed: ${error.message}`);

    const updated = await prisma.customer.update({
      where: { id },
      data: { taxExemptDocPath: key, taxExemptDocName: file.name.slice(0, 200) },
    });

    // Best-effort cleanup of the file we just replaced.
    if (customer.taxExemptDocPath && customer.taxExemptDocPath !== key) {
      await admin.storage.from(TAX_EXEMPT_BUCKET).remove([customer.taxExemptDocPath]);
    }

    return ok({ customer: updated }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Remove the certificate from storage and clear it off the customer.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    await assertCustomerInScope(id, actor);
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: { taxExemptDocPath: true },
    });
    if (!customer) throw new HttpError(404, "Customer not found");
    if (customer.taxExemptDocPath) {
      await supabaseAdmin()
        .storage.from(TAX_EXEMPT_BUCKET)
        .remove([customer.taxExemptDocPath]);
    }
    const updated = await prisma.customer.update({
      where: { id },
      data: { taxExemptDocPath: "", taxExemptDocName: "" },
    });
    return ok({ customer: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
