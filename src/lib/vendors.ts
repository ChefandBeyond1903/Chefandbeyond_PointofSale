import { prisma } from "@/lib/prisma";

/**
 * Make sure a Vendor row exists for this name. Products carry the vendor as a
 * plain string; this keeps the Vendors page in sync so any vendor put on a
 * product shows up there (with blank contact details until someone fills them).
 */
export async function ensureVendor(name: string | null | undefined): Promise<void> {
  const n = name?.trim();
  if (!n) return;
  await prisma.vendor.upsert({ where: { name: n }, update: {}, create: { name: n } });
}
