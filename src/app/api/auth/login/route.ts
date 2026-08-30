import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, startSession } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import { ok, toErrorResponse } from "@/lib/api";

export async function POST(req: NextRequest) {
  try {
    const body = loginSchema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });

    const genericError = () => ok({ error: "Invalid email or password" }, 401);

    if (!user || !user.active) return genericError();
    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) return genericError();

    const role =
      user.role === "ADMIN" ? "ADMIN" : user.role === "MANAGER" ? "MANAGER" : "CASHIER";
    const sessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: role as "CASHIER" | "MANAGER" | "ADMIN",
    };
    await startSession(sessionUser);
    return ok({ user: sessionUser });
  } catch (err) {
    return toErrorResponse(err);
  }
}
