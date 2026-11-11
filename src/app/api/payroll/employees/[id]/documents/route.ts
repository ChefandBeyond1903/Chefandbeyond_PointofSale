import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { EMPLOYEE_DOCS_BUCKET, ensureEmployeeDocsBucket, safeFileName } from "@/lib/storage";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

const TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const KINDS = ["W4", "I9", "W9", "ID", "OTHER"];
const MAX_BYTES = 10 * 1024 * 1024;

// Attach a document (W-4, I-9, W-9, ID, …). multipart/form-data: "file" + "kind".
export async function POST(req: NextRequest, { params }: Params) {
  try {
    await requireRole("ADMIN");
    const { id } = await params;
    const employee = await prisma.employee.findUnique({ where: { id }, select: { id: true } });
    if (!employee) throw new HttpError(404, "Employee not found");

    const form = await req.formData();
    const file = form.get("file");
    const kindRaw = String(form.get("kind") ?? "OTHER").toUpperCase();
    const kind = KINDS.includes(kindRaw) ? kindRaw : "OTHER";
    if (!(file instanceof File)) throw new HttpError(400, "Attach a file to upload.");
    if (!TYPES.includes(file.type)) throw new HttpError(400, "File must be a PDF, PNG, JPG, or WEBP.");
    if (file.size > MAX_BYTES) throw new HttpError(400, "File must be 10 MB or smaller.");

    await ensureEmployeeDocsBucket();
    const key = `${id}/${Date.now()}-${safeFileName(file.name)}`;
    const { error } = await supabaseAdmin()
      .storage.from(EMPLOYEE_DOCS_BUCKET)
      .upload(key, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (error) throw new HttpError(500, `Upload failed: ${error.message}`);

    const document = await prisma.employeeDocument.create({
      data: { employeeId: id, kind, fileName: file.name.slice(0, 200), storagePath: key },
    });
    return ok({ document }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
