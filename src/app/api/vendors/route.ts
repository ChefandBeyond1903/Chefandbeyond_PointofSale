import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireRole } from "@/lib/auth";
import { vendorCreateSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

export async function GET() {
  try {
    await requireUser();
    const vendors = await prisma.vendor.findMany({ orderBy: { name: "asc" } });
    // How many products currently carry each vendor name.
    const counts = await prisma.product.groupBy({
      by: ["vendor"],
      _count: { _all: true },
    });
    const byName = new Map(counts.map((c) => [c.vendor, c._count._all]));
    return ok({
      vendors: vendors.map((v) => ({ ...v, productCount: byName.get(v.name) ?? 0 })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole("MANAGER", "ADMIN");
    const data = vendorCreateSchema.parse(await req.json());
    const vendor = await prisma.vendor.create({ data });
    return ok({ vendor }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
