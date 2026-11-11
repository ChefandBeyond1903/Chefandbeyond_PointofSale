import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { EMPLOYEE_DOCS_BUCKET } from "@/lib/storage";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ docId: string }> };

// A short-lived download link for one employee document.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireRole("ADMIN");
    const { docId } = await params;
    const doc = await prisma.employeeDocument.findUnique({ where: { id: docId } });
    if (!doc) throw new HttpError(404, "Document not found");
    const { data, error } = await supabaseAdmin()
      .storage.from(EMPLOYEE_DOCS_BUCKET)
      .createSignedUrl(doc.storagePath, 120);
    if (error || !data) throw new HttpError(500, "Could not create a download link");
    return ok({ url: data.signedUrl, name: doc.fileName });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireRole("ADMIN");
    const { docId } = await params;
    const doc = await prisma.employeeDocument.findUnique({ where: { id: docId } });
    if (!doc) throw new HttpError(404, "Document not found");
    await supabaseAdmin().storage.from(EMPLOYEE_DOCS_BUCKET).remove([doc.storagePath]);
    await prisma.employeeDocument.delete({ where: { id: docId } });
    return ok({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
