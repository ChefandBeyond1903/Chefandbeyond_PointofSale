import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { shiftOpenSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = shiftOpenSchema.parse(await req.json());

    const existing = await prisma.shift.findFirst({
      where: { userId: user.id, status: "OPEN" },
    });
    if (existing) throw new HttpError(409, "You already have an open shift");

    const shift = await prisma.shift.create({
      data: { userId: user.id, openingFloatCents: body.openingFloatCents },
    });
    return ok({ shift }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
