import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireRole } from "@/lib/auth";
import { companyUpdateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

const EMPTY = {
  name: "",
  legalName: "",
  taxId: "",
  address: "",
  phone: "",
  email: "",
  website: "",
};

export async function GET() {
  try {
    await requireUser();
    const row = await prisma.company.findUnique({ where: { id: "company" } });
    return ok({ company: row ?? EMPTY });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireRole("ADMIN");
    const data = companyUpdateSchema.parse(await req.json());
    const company = await prisma.company.upsert({
      where: { id: "company" },
      create: { id: "company", ...data },
      update: data,
    });
    return ok({ company });
  } catch (err) {
    return toErrorResponse(err);
  }
}
