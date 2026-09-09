import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScopedUser, requireScopedRole, assertCustomerInScope } from "@/lib/scope";
import { customerLocationSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedUser();
    const { id } = await params;
    await assertCustomerInScope(id, actor);
    const locations = await prisma.customerLocation.findMany({
      where: { customerId: id },
      orderBy: [{ active: "desc" }, { label: "asc" }],
    });
    return ok({ locations });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireScopedRole("MANAGER", "ADMIN");
    const { id } = await params;
    await assertCustomerInScope(id, actor);
    const f = customerLocationSchema.parse(await req.json());
    const location = await prisma.customerLocation.create({
      data: { customerId: id, ...f },
    });
    return ok({ location }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
